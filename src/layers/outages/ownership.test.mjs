import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutagesLayer } from './index.js';

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
  const layer = createOutagesLayer({
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
  county: {
    fips: '34009',
    customersOut: 85,
    customersTracked: 113764,
    pct: 0.07,
    incidentCount: 1,
    utilities: [],
  },
  areas: [
    {
      name: 'OCEAN CITY',
      utilityKey: '963',
      utilityName: 'Atlantic City Electric Co',
      areaType: 'muni',
      customersServed: 22014,
      customersOut: 85,
      maskedOutages: 0,
      incidentCount: 1,
      etr: '2026-11-16T19:00:00.000Z',
      etrMs: Date.parse('2026-11-16T19:00:00.000Z'),
      bbox: {
        west: -74.6552594577,
        south: 39.2068500528,
        east: -74.5402959701,
        north: 39.3100966021,
      },
      lat: 39.25847332745,
      lon: -74.5977777094,
      asOf: '2026-11-16T17:00:41.427Z',
      asOfMs: Date.parse('2026-11-16T17:00:41.427Z'),
      pctOut: 0.386,
    },
  ],
  alerts: { fips: '34009', majorEventPct: 10, utilities: [] },
  majorEvent: false,
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

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => snapshot });
  const b = harness({
    getSnapshot: async () => ({ ...snapshot, areas: [] }),
  });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 1);
  assert.equal(a.layer.getStats().customersOut, 85);
  assert.equal(b.layer.getStats().count, 0);
  // One county summary entry + one area entry; the quiet display still
  // carries its county summary entry.
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'outages');
  assert.equal(a.events[0][1].length, 2);
  assert.equal(a.events[0][1][0].id, 'outages-county');
  assert.equal(b.events[0][1].length, 1);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['outages']);
  assert.deepEqual(h.visible.at(-1), ['outages', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, 'OCEAN CITY');
  assert.equal(record.area, 'OCEAN CITY');
  assert.equal(record.customersOut, 85);
  assert.equal(record.customersServed, 22014);
  assert.ok(Math.abs(record.pctOut - 0.386) < 1e-12);
  assert.equal(record.severity, 'watch');
  assert.equal(record.time, '2026-11-16T17:00:41.427Z');
  assert.ok(Math.abs(record.lat - 39.25847332745) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.5977777094) < 1e-6);
  h.layer.destroy(h.viewer);
});
