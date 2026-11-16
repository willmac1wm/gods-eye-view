import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaaStatusLayer } from './index.js';

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
  const layer = createFaaStatusLayer({
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
  updateTime: 'Mon Nov 16 19:28:03 2026 GMT',
  updateTimeMs: Date.parse('Mon Nov 16 19:28:03 2026 GMT'),
  updateStale: false,
  local: [
    {
      airport: 'ACY',
      category: 'ground-stop',
      reason: 'telecom failure',
      start: null,
      reopen: null,
      endTime: '09:00 pm EST',
      avg: null,
      max: null,
      trend: null,
      delayType: null,
      startMs: null,
      reopenMs: null,
    },
  ],
  nationwide: {
    groundStop: 12,
    groundDelay: 4,
    closure: 5,
    arrivalDepartureDelay: 2,
  },
  totalAirports: 21,
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

test('a local ground stop pins ACY and reports nationwide counts', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().nationwideGroundStops, 12);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'faa-status');
  assert.equal(h.events[0][1].length, 1);
  assert.equal(h.events[0][1][0].title, 'ACY — Ground Stop');
  assert.equal(h.events[0][1][0].subtitle, 'telecom failure');
  h.layer.destroy(h.viewer);
});

test('a quiet feed renders nothing and reports zero local events', async () => {
  const h = harness({
    getSnapshot: async () => ({ ...snapshot, local: [] }),
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][1].length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['faa-status']);
  assert.deepEqual(h.visible.at(-1), ['faa-status', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, 'ACY:ground-stop');
  assert.equal(record.airport, 'ACY');
  assert.equal(record.category, 'ground-stop');
  assert.equal(record.reason, 'telecom failure');
  assert.ok(Math.abs(record.lat - 39.4576) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.5772) < 1e-6);
  h.layer.destroy(h.viewer);
});
