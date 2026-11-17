import assert from 'node:assert/strict';
import test from 'node:test';
import { createDroughtLayer } from './index.js';

function harness(source) {
  const sources = [];
  const events = [];
  const visible = [];
  const cleared = [];
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
  const layer = createDroughtLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(args);
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
  return { layer, viewer, sources, events, visible, cleared };
}

const snapshot = {
  fetchedAt: 1,
  releasedAt: 'Thu, 12 Nov 2026 11:15:51 GMT',
  stale: false,
  category: 0,
  categories: [{ point: { lat: 39.08, lon: -74.9 }, category: 0 }],
};

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve(snapshot);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('update publishes one D0 label with the release date (live values)', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'drought');
  assert.match(h.events[0][1][0].title, /D0 Abnormally Dry/);
  assert.match(h.events[0][1][0].subtitle, /Nov 12, 2026/);
  assert.equal(h.layer.getStats().category, 0);
  assert.equal(h.layer.getStats().code, 'D0');
  h.layer.destroy(h.viewer);
});

test('a no-drought snapshot publishes the all-clear label', async () => {
  const h = harness({
    getSnapshot: async () => ({ ...snapshot, category: null, categories: [] }),
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.match(h.events[0][1][0].title, /No drought/);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['drought']);
  assert.deepEqual(h.visible.at(-1), ['drought', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry the county drought reading', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].category, 0);
  assert.equal(records[0].code, 'D0');
  h.layer.destroy(h.viewer);
});
