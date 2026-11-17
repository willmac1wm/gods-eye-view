import assert from 'node:assert/strict';
import test from 'node:test';
import { createRadiationLayer } from './index.js';

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
  const layer = createRadiationLayer({
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
  stale: false,
  monitors: [
    {
      key: 'philadelphia',
      name: 'Philadelphia',
      state: 'PA',
      doseRateNSvH: 41,
      gammaCpmR02: 1438,
      sampleTime: '2026-11-16T21:39:00.000Z',
      distanceKm: 101,
    },
    {
      key: 'edison',
      name: 'Edison',
      state: 'NJ',
      doseRateNSvH: 39,
      gammaCpmR02: 1348,
      sampleTime: '2026-11-16T21:42:00.000Z',
      distanceKm: 163,
    },
  ],
  safecast: {
    value: 26,
    unit: 'cpm',
    lat: 38.808321666666664,
    lon: -76.97334833333333,
    capturedAt: '2017-06-06T20:22:57.000Z',
  },
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

test('update publishes one label with the nearest monitor (live values)', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'radiation');
  assert.match(h.events[0][1][0].title, /41 nSv\/h · Philadelphia/);
  assert.match(h.events[0][1][0].subtitle, /Edison 39 nSv\/h/);
  assert.equal(h.layer.getStats().nearestMonitor, 'Philadelphia');
  assert.equal(h.layer.getStats().doseRateNSvH, 41);
  assert.equal(h.layer.getStats().safecastValue, 26);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['radiation']);
  assert.deepEqual(h.visible.at(-1), ['radiation', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per monitor', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].monitor, 'Philadelphia');
  assert.equal(records[0].doseRateNSvH, 41);
  assert.equal(records[1].monitor, 'Edison');
  assert.equal(records[1].gammaCpmR02, 1348);
  h.layer.destroy(h.viewer);
});
