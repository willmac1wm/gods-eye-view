// src/layers/hifldInstallations/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHifldInstallationsLayer } from './index.js';
import { createHifldInstallationsSource } from './source.js';

function harness({ source = createHifldInstallationsSource() } = {}) {
  const published = [];
  const visible = [];
  const cleared = [];
  const sources = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createHifldInstallationsLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        published.push(args);
      },
      setVisible(...args) {
        visible.push(args);
      },
      clearSource(...args) {
        cleared.push(args);
      },
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, published, visible, cleared, sources };
}

test('update publishes the first 100 home-first pins; stats stay frozen', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0][0], 'hifld-installations');
  assert.equal(h.published[0][1].length, 100);
  assert.match(h.published[0][1][0].title, /🪖/);
  assert.equal(h.layer.getStats().count, 744);
  assert.equal(h.layer.getStats().stale, true);
  assert.equal(h.layer.getAnalystRecords().length, 744);
  assert.equal(
    h.layer.getAnalystRecords()[0].kind,
    'installation',
  );
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the layer usable and records the error', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  const failing = createHifldInstallationsLayer({
    source: {
      getSnapshot: () => {
        throw new Error('Invalid HIFLD installations snapshot');
      },
    },
    overlayHost: {
      setEntries(...args) {
        h.published.push(args);
      },
      setVisible(...args) {
        h.visible.push(args);
      },
      clearSource(...args) {
        h.cleared.push(args);
      },
    },
  });
  failing.init(h.viewer);
  failing.enable(h.viewer);
  assert.equal(await failing.update(h.viewer), false);
  assert.match(
    failing.getStats().error,
    /Invalid HIFLD installations snapshot/,
  );
  // Frozen by design, even on error.
  assert.equal(failing.getStats().stale, true);
  failing.destroy(h.viewer);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.cleared[0][0], 'hifld-installations');
  assert.equal(h.sources.length, 0);
});
