/**
 * A lost or failed WebGL context used to leave Cesium's raw dialog up and
 * the crashed tab holding the context, so the next tab could not start.
 * Construction is tried twice. After that, and after a render-loop error,
 * the viewer is destroyed and a branded screen replaces the dialog.
 */

import { t } from '../i18n/index.js';

export const GRAPHICS_RESET_ID = 'gev-graphics-reset';

const SCREEN_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:10000',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'background:#0a0a0f',
  'color:#e8eaed',
  'font-family:Inter,system-ui,sans-serif',
  'text-align:center',
  'padding:32px',
].join(';');

/**
 * Full-screen "Graphics reset needed" with a Reload button.
 * @param {Document} doc
 * @param {Window} [windowRef]
 * @returns {HTMLElement|null}
 */
export function showGraphicsReset(doc, windowRef = globalThis.window) {
  if (!doc?.getElementById || doc.getElementById(GRAPHICS_RESET_ID))
    return doc?.getElementById?.(GRAPHICS_RESET_ID) ?? null;
  const root = doc.createElement('div');
  root.id = GRAPHICS_RESET_ID;
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'gev-graphics-reset-title');
  root.style.cssText = SCREEN_STYLE;
  const card = doc.createElement('div');
  const title = doc.createElement('h1');
  title.id = 'gev-graphics-reset-title';
  title.textContent = t('Graphics reset needed');
  title.style.cssText =
    'font-family:JetBrains Mono,ui-monospace,monospace;font-size:22px;letter-spacing:0.14em;font-weight:600;margin:0 0 16px';
  const hint = doc.createElement('p');
  hint.textContent = t(
    'This tab lost its graphics. Close other tabs of this site, then reload.',
  );
  hint.style.cssText =
    'max-width:36rem;margin:0 auto 24px;line-height:1.5;color:rgba(232,234,237,0.72)';
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = t('Reload');
  button.style.cssText =
    'font:600 14px JetBrains Mono,ui-monospace,monospace;letter-spacing:0.12em;color:#0a0a0f;background:#00d4ff;border:0;border-radius:10px;padding:12px 22px;cursor:pointer';
  button.addEventListener('click', () => {
    windowRef?.location?.reload?.();
  });
  card.append(title, hint, button);
  root.append(card);
  (doc.body ?? doc.documentElement)?.append(root);
  return root;
}

/** Remove the reset screen after the context comes back. */
export function hideGraphicsReset(doc) {
  doc?.getElementById?.(GRAPHICS_RESET_ID)?.remove();
}

/** Drop Cesium's own "Error constructing CesiumWidget" panel. */
export function clearCesiumErrorPanel(container, doc = globalThis.document) {
  const root =
    typeof container === 'string' ? doc?.getElementById?.(container) : container;
  root?.querySelectorAll?.('.cesium-widget-errorPanel')?.forEach((node) => {
    node.remove();
  });
}

/**
 * Call `create` up to twice. The second call is the automatic retry.
 * @param {() => object} create
 * @param {{attempts?: number, beforeRetry?: Function}} [options]
 */
export function constructViewerWithRetry(create, { attempts = 2, beforeRetry } = {}) {
  let error = null;
  const tries = Math.max(1, attempts);
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return { viewer: create(), attempts: attempt, error: null };
    } catch (caught) {
      error = caught;
      if (attempt < tries) beforeRetry?.(caught, attempt);
    }
  }
  return { viewer: null, attempts: tries, error };
}

/** Destroy a viewer once. Later calls are a no-op. */
export function releaseViewer(viewer) {
  if (!viewer || viewer.isDestroyed?.()) return false;
  viewer.destroy();
  return true;
}

/**
 * Free the context when the page goes away or the render loop dies, and let
 * a lost context recover when the browser restores it.
 * @returns {() => void} Remove the listeners.
 */
export function bindGraphicsLifecycle(viewer, { documentRef, windowRef, onReset }) {
  const canvas = viewer?.canvas ?? viewer?.scene?.canvas;
  const onLost = (event) => {
    event.preventDefault?.();
    const onRestored = () => {
      hideGraphicsReset(documentRef);
      try {
        viewer.scene?.requestRender?.();
      } catch {
        /* the restored context still paints on the next frame */
      }
    };
    canvas?.addEventListener?.('webglcontextrestored', onRestored, { once: true });
    onReset?.('context-lost');
  };
  canvas?.addEventListener?.('webglcontextlost', onLost);
  const onRenderError = () => {
    releaseViewer(viewer);
    onReset?.('render-error');
  };
  const removeRenderError = viewer?.scene?.renderError?.addEventListener?.(onRenderError);
  const onPageGone = () => {
    releaseViewer(viewer);
  };
  windowRef?.addEventListener?.('pagehide', onPageGone);
  windowRef?.addEventListener?.('unload', onPageGone);
  return () => {
    canvas?.removeEventListener?.('webglcontextlost', onLost);
    removeRenderError?.();
    windowRef?.removeEventListener?.('pagehide', onPageGone);
    windowRef?.removeEventListener?.('unload', onPageGone);
  };
}
