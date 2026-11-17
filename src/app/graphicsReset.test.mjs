import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  GRAPHICS_RESET_ID,
  bindGraphicsLifecycle,
  clearCesiumErrorPanel,
  constructViewerWithRetry,
  releaseViewer,
  showGraphicsReset,
} from './graphicsReset.js';

function page() {
  const window = new Window();
  const document = window.document;
  document.body.innerHTML = '<div id="cesiumContainer"></div>';
  return { window, document };
}

test('viewer construction retries once, then shows the branded screen', () => {
  const { window, document } = page();
  let calls = 0;
  const failed = constructViewerWithRetry(
    () => {
      calls += 1;
      const panel = document.createElement('div');
      panel.className = 'cesium-widget-errorPanel';
      panel.textContent = 'Error constructing CesiumWidget';
      document.getElementById('cesiumContainer').append(panel);
      throw new Error('WebGL initialization failed');
    },
    {
      beforeRetry() {
        clearCesiumErrorPanel('cesiumContainer', document);
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(failed.viewer, null);
  clearCesiumErrorPanel('cesiumContainer', document);
  assert.equal(document.querySelector('.cesium-widget-errorPanel'), null);
  const screen = showGraphicsReset(document, window);
  assert.equal(screen.id, GRAPHICS_RESET_ID);
  assert.match(screen.textContent, /Graphics reset needed/);
  assert.match(screen.textContent, /Close other tabs of this site/);
  assert.equal(screen.querySelector('button').textContent, 'Reload');
  let reloaded = 0;
  window.location.reload = () => {
    reloaded += 1;
  };
  screen.querySelector('button').click();
  assert.equal(reloaded, 1);

  const recovered = constructViewerWithRetry(() => {
    calls += 1;
    if (calls === 3) throw new Error('once');
    return { id: 'viewer' };
  });
  assert.equal(recovered.viewer.id, 'viewer');
  assert.equal(recovered.attempts, 2);
});

test('a lost context can be restored, and a render error frees the viewer', () => {
  const { window, document } = page();
  const listeners = new Map();
  const canvas = {
    addEventListener(type, fn, options) {
      listeners.set(type, { fn, options });
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  let destroyed = false;
  let renders = 0;
  const viewer = {
    canvas,
    isDestroyed: () => destroyed,
    destroy() {
      destroyed = true;
    },
    scene: {
      requestRender() {
        renders += 1;
      },
      renderError: {
        addEventListener(fn) {
          listeners.set('renderError', { fn });
          return () => listeners.delete('renderError');
        },
      },
    },
  };
  const reasons = [];
  bindGraphicsLifecycle(viewer, {
    documentRef: document,
    windowRef: window,
    onReset(reason) {
      reasons.push(reason);
      if (reason === 'render-error') releaseViewer(viewer);
      showGraphicsReset(document, window);
    },
  });

  const lost = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  listeners.get('webglcontextlost').fn(lost);
  assert.equal(lost.defaultPrevented, true);
  assert.equal(reasons.at(-1), 'context-lost');
  assert.equal(document.getElementById(GRAPHICS_RESET_ID) != null, true);
  listeners.get('webglcontextrestored').fn();
  assert.equal(document.getElementById(GRAPHICS_RESET_ID), null);
  assert.equal(renders, 1);
  assert.equal(destroyed, false);

  listeners.get('renderError').fn();
  assert.equal(destroyed, true);
  assert.equal(releaseViewer(viewer), false);
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(destroyed, true);
});

test('leaving the page destroys a live viewer', () => {
  const { window, document } = page();
  let destroyed = false;
  const viewer = {
    canvas: { addEventListener() {}, removeEventListener() {} },
    isDestroyed: () => destroyed,
    destroy() {
      destroyed = true;
    },
    scene: { renderError: { addEventListener() { return () => {}; } } },
  };
  bindGraphicsLifecycle(viewer, {
    documentRef: document,
    windowRef: window,
    onReset() {},
  });
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(destroyed, true);
});
