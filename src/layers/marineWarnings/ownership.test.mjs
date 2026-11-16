import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarineWarningsLayer } from './index.js';

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
  const layer = createMarineWarningsLayer({
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

const pinnedRow = {
  stableId: 'CGD-E:0478-26',
  originator: 'CGD-E',
  number: '0478-26',
  criticality: 'SAFETY',
  area: 'NJ-ATLANTIC CITY OPERATING AREA (ACOA)',
  descriptor: 'HAZ OPS',
  title:
    'SAFETY/NJ-ATLANTIC CITY OPERATING AREA (ACOA)-HAZOPS-WEEK OF 12-18 OCT 26/HAZ OPS/CGD-E BNM 0478-26',
  body: 'FIRING EXERCISES 14 OCT 0800-1200',
  link: null,
  pubDateMs: Date.parse('2026-10-12T10:00:00Z'),
  cancelAtMs: Date.parse('2026-10-19T05:30:00Z'),
  llnr: null,
  lat: 38.9929,
  lon: -74.2229,
  hasPosition: true,
  polygon: true,
  vertices: 4,
  severity: 'high',
};

const listOnlyRow = {
  stableId: 'SEC SDB:0288-26',
  originator: 'SEC SDB',
  number: '0288-26',
  criticality: 'SAFETY',
  area: 'DELAWARE RIVER',
  descriptor: 'ATON',
  title: 'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
  body: 'LISTON RANGE FRONT LIGHT (LLNR 2445) REPORTED WITH A LOW INTENSITY LIGHT.',
  link: null,
  pubDateMs: Date.parse('2026-11-14T04:24:32Z'),
  cancelAtMs: Date.parse('2026-11-22T00:00:00Z'),
  llnr: '2445',
  lat: null,
  lon: null,
  hasPosition: false,
  polygon: false,
  vertices: 0,
  severity: 'moderate',
};

const snapshot = {
  rows: [pinnedRow, listOnlyRow],
  cancelledCount: 1,
  totalItems: 3,
  pinnedCount: 1,
  listOnlyCount: 1,
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
  const b = harness({ getSnapshot: async () => ({ ...snapshot, rows: [] }) });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 2);
  assert.equal(a.layer.getStats().pinned, 1);
  assert.equal(a.layer.getStats().listOnly, 1);
  assert.equal(a.layer.getStats().cancelledCount, 1);
  assert.equal(b.layer.getStats().count, 0);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'marine-warnings');
  // Only the positioned warning gets an overlay entry.
  assert.equal(a.events[0][1].length, 1);
  assert.equal(a.events[0][1][0].title, 'BNM 0478-26 · HAZ OPS');
  assert.deepEqual(a.events[0][2], {
    cohortLimit: 96,
    collisionCapacity: 48,
    moving: false,
  });
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['marine-warnings']);
  assert.deepEqual(h.visible.at(-1), ['marine-warnings', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    pinned: 0,
    listOnly: 0,
    cancelledCount: 0,
    lastUpdate: null,
    error: null,
  });
});

test('list-only rows count in stats but never become entities or analyst records', async () => {
  const h = harness({
    getSnapshot: async () => ({ ...snapshot, rows: [listOnlyRow] }),
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().pinned, 0);
  assert.equal(h.layer.getStats().listOnly, 1);
  assert.equal(h.events[0][1].length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, 'CGD-E:0478-26');
  assert.equal(record.descriptor, 'HAZ OPS');
  assert.equal(record.severity, 'high');
  assert.equal(record.polygon, true);
  assert.equal(record.hasPosition, true);
  assert.ok(Math.abs(record.lat - 38.9929) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.2229) < 1e-6);
  h.layer.destroy(h.viewer);
});

test('source failure leaves the layer empty with its own error', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('proxy down');
    },
  });
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.layer.getStats().error, 'proxy down');
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});
