import assert from 'node:assert/strict';
import test from 'node:test';
import { createSatnogsLayer } from './index.js';

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
  const layer = createSatnogsLayer({
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

const goodRow = {
  stableId: 'satnogs:15449441',
  id: 15449441,
  satelliteName: 'CPSAT',
  noradCatId: 98194,
  stationId: 223,
  stationName: 'W2MMD GCARC Clubhouse',
  lat: 39.716,
  lon: -75.21,
  startMs: Date.parse('2026-11-16T05:12:41Z'),
  endMs: Date.parse('2026-11-16T05:22:03Z'),
  status: 'good',
  vettedStatus: null,
  waterfallUrl:
    'https://s3.eu-central-1.wasabisys.com/satnogs-network/data_obs/2026/11/16/5/15449441/waterfall_15449441_2026-11-16T05-12-41.png',
  audioUrl:
    'https://network-satnogs.freetls.fastly.net/media/data_obs/2026/11/16/5/15449441/satnogs_15449441_2026-11-16T05-12-41.ogg',
  observationUrl: 'https://network.satnogs.org/observations/15449441/',
  demodCount: 21,
  transmitterDescription: 'Mode U - BPSK9k6 - AX.25 G3RUH',
  transmitterMode: 'BPSK',
  downlinkHz: 437265000,
  maxAltitude: 29,
  riseAzimuth: 196,
  setAzimuth: 331,
};

const futureRow = {
  stableId: 'satnogs:15458254',
  id: 15458254,
  satelliteName: 'ISS',
  noradCatId: 98914,
  stationId: 223,
  stationName: 'W2MMD GCARC Clubhouse',
  lat: 39.716,
  lon: -75.21,
  startMs: Date.parse('2026-11-17T16:56:41Z'),
  endMs: Date.parse('2026-11-17T17:06:41Z'),
  status: 'future',
  vettedStatus: null,
  waterfallUrl: null,
  audioUrl: null,
  observationUrl: 'https://network.satnogs.org/observations/15458254/',
  demodCount: 0,
  transmitterDescription: null,
  transmitterMode: null,
  downlinkHz: null,
  maxAltitude: null,
  riseAzimuth: null,
  setAzimuth: null,
};

const snapshot = {
  rows: [futureRow, goodRow],
  stations: [
    {
      id: 223,
      name: 'W2MMD GCARC Clubhouse',
      lat: 39.716,
      lon: -75.21,
      distanceKm: 84,
      observations: 64276,
      successRate: 67,
      completedCount: 1,
      scheduledCount: 1,
      latestStartMs: Date.parse('2026-11-17T16:56:41Z'),
    },
    {
      id: 2575,
      name: 'KC3QNJ',
      lat: 38.308,
      lon: -76.474,
      distanceKm: 157,
      observations: 2521,
      successRate: 68,
      completedCount: 0,
      scheduledCount: 0,
      latestStartMs: null,
    },
    {
      id: 4655,
      name: 'Alx2',
      lat: 38.78407,
      lon: -77.11324,
      distanceKm: 193,
      observations: 13689,
      successRate: 65,
      completedCount: 0,
      scheduledCount: 0,
      latestStartMs: null,
    },
    {
      id: 3610,
      name: 'ka6akh-ground-station',
      lat: 38.8246,
      lon: -77.14037,
      distanceKm: 195,
      observations: 7101,
      successRate: 79,
      completedCount: 0,
      scheduledCount: 0,
      latestStartMs: null,
    },
  ],
  completedCount: 1,
  scheduledCount: 1,
  totalObservations: 2,
  stationCount: 4,
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
  assert.equal(a.layer.getStats().completed, 1);
  assert.equal(a.layer.getStats().scheduled, 1);
  assert.equal(b.layer.getStats().count, 0);
  // One entity per station (4), one overlay entry per station.
  assert.equal(a.sources[0].entities.values.length, 4);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'satnogs');
  assert.equal(a.events[0][1].length, 4);
  assert.equal(a.events[0][1][0].title, 'W2MMD GCARC Clubhouse');
  assert.equal(a.events[0][1][0].subtitle, '1 heard · 1 scheduled');
  assert.deepEqual(a.events[0][2], {
    cohortLimit: 8,
    collisionCapacity: 4,
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
  assert.deepEqual(h.cleared.at(-1), ['satnogs']);
  assert.deepEqual(h.visible.at(-1), ['satnogs', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.deepEqual(h.layer.getStats(), {
    count: 0,
    completed: 0,
    scheduled: 0,
    lastUpdate: null,
    error: null,
  });
});

test('quiet stations still get pins, with zero counts', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 2);
  // All four stations pinned, including the three with no observations.
  assert.equal(h.sources[0].entities.values.length, 4);
  const quiet = h.sources[0].entities.values.find(
    (entity) => entity.id === 'satnogs-station:2575',
  );
  assert.equal(
    quiet.properties.completedCount.getValue(),
    0,
  );
  h.layer.destroy(h.viewer);
});

test('analyst records round-trip through the station entities', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  const [first] = records;
  assert.equal(first.id, 'satnogs:15458254');
  assert.equal(first.satelliteName, 'ISS');
  assert.equal(first.status, 'future');
  assert.equal(first.stationId, 223);
  assert.equal(first.hasPosition, true);
  assert.ok(Math.abs(first.lat - 39.716) < 1e-6);
  assert.ok(Math.abs(first.lon - -75.21) < 1e-6);
  const [, second] = records;
  assert.equal(second.id, 'satnogs:15449441');
  assert.equal(second.hasWaterfall, true);
  assert.equal(second.hasAudio, true);
  assert.equal(second.downlinkHz, 437265000);
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
