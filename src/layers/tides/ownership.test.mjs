import assert from 'node:assert/strict';
import test from 'node:test';
import { createTidesLayer } from './index.js';

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
  const layer = createTidesLayer({
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

const row = {
  stationId: '8536110',
  name: 'Cape May',
  lon: -74.96,
  lat: 38.9683,
  observedFtMllw: 2.536,
  observedTime: '2026-11-15 21:12',
  predictedFtMllw: 1.949,
  residualFt: 0.587,
  floodStage: 'none',
  trend: 'rising',
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
    resolve([row]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => [row] });
  const b = harness({ getSnapshot: async () => [] });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 1);
  assert.equal(b.layer.getStats().count, 0);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'tides');
  assert.equal(a.events[0][1].length, 1);
  assert.equal(a.events[0][1][0].title, 'Cape May 2.5′ ▲');
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => [row] });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['tides']);
  assert.deepEqual(h.visible.at(-1), ['tides', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => [row] });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, '8536110');
  assert.equal(record.station, 'Cape May');
  assert.equal(record.observedFtMllw, 2.536);
  assert.equal(record.residualFt, 0.587);
  assert.equal(record.floodStage, 'none');
  assert.equal(record.trend, 'rising');
  assert.equal(record.time, '2026-11-15 21:12');
  assert.ok(Math.abs(record.lat - 38.9683) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.96) < 1e-6);
  h.layer.destroy(h.viewer);
});
