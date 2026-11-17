import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountyRiskSource } from './source.js';

const NOW = 1794772800000;

function calmLayers() {
  return {
    nwsAlertCard: {
      getAnalystRecords: () => [],
      getStats: () => ({ count: 0, lastUpdate: NOW }),
    },
    tides: {
      getAnalystRecords: () => [
        { observedFtMllw: 2.0, floodStage: 'none', timeMs: NOW },
      ],
      getStats: () => ({ count: 1, lastUpdate: NOW }),
    },
    gauges: {
      getAnalystRecords: () => [],
      getStats: () => ({ count: 0, lastUpdate: NOW }),
    },
    outages: {
      getAnalystRecords: () => [],
      getStats: () => ({
        count: 0,
        customersOut: 0,
        majorEvent: false,
        lastUpdate: NOW,
      }),
    },
    gdacs: {
      getAnalystRecords: () => [],
      getStats: () => ({ count: 0, lastUpdate: NOW }),
    },
    earthquakes: {
      getAnalystRecords: () => [],
      getStats: () => ({ count: 0, lastUpdate: NOW }),
    },
    firms: { getAnalystRecords: () => [] },
    spaceWeather: {
      getAnalystRecords: () => [{ kp: 3, gScale: null, timeMs: NOW }],
      getStats: () => ({ count: 1, kp: 3, lastUpdate: NOW }),
    },
  };
}

function lightningFetch(flashes30m = 0, flashes60m = 0) {
  return async () => ({
    ok: true,
    json: async () => ({
      flashes30m,
      flashes60m,
      lastFlashMs: null,
      checkedAtMs: NOW,
    }),
  });
}

test('calm layers + no lightning score 0, band Low', async () => {
  const source = createCountyRiskSource({
    readLayers: calmLayers,
    fetchImpl: lightningFetch(),
    now: () => NOW,
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.score, 0);
  assert.equal(snapshot.band.label, 'Low');
  assert.equal(snapshot.components.lightning.value, 0);
  assert.deepEqual(snapshot.missingInputs, []);
  assert.equal(snapshot.stale, false);
});

test('a warning + high tide lifts the score and names the rules', async () => {
  const layers = calmLayers();
  layers.nwsAlertCard.getAnalystRecords = () => [
    { event: 'Coastal Flood Warning', severity: 'Moderate', timeMs: NOW },
  ];
  layers.tides.getAnalystRecords = () => [
    { observedFtMllw: 6.5, floodStage: 'minor', timeMs: NOW },
  ];
  const source = createCountyRiskSource({
    readLayers: () => layers,
    fetchImpl: lightningFetch(),
    now: () => NOW,
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.components.weather.value, 70);
  assert.ok(
    snapshot.components.weather.rules.includes('Tide ≥ 6.2 ft (minor flood)'),
  );
  assert.ok(snapshot.components.weather.rules.includes('NWS warning active'));
  assert.equal(snapshot.score, 28); // 0.4*70
  assert.equal(snapshot.band.label, 'Guarded');
});

test('a lightning 503 leaves lightning missing and renormalizes', async () => {
  const source = createCountyRiskSource({
    readLayers: calmLayers,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    now: () => NOW,
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.components.lightning.available, false);
  assert.ok(snapshot.missingInputs.includes('lightning'));
  // All other components are 0, so the score is still 0 — over the
  // remaining 0.9 weight, not a silent zero for lightning.
  assert.equal(snapshot.score, 0);
});

test('a lightning fetch throw also leaves lightning missing', async () => {
  const source = createCountyRiskSource({
    readLayers: calmLayers,
    fetchImpl: async () => {
      throw new Error('network down');
    },
    now: () => NOW,
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.components.lightning.available, false);
});

test('no inputs at all → score null, never a default 0', async () => {
  const source = createCountyRiskSource({
    readLayers: () => ({}),
    fetchImpl: async () => ({ ok: false, status: 503 }),
    now: () => NOW,
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.score, null);
  assert.equal(snapshot.band, null);
  assert.equal(snapshot.missingInputs.length, 5);
});

test('the outage ring answers "rising" only with an hour-old reading', async () => {
  let nowMs = NOW;
  const layers = calmLayers();
  layers.outages.getStats = () => ({
    count: 1,
    customersOut: 400,
    majorEvent: false,
    lastUpdate: nowMs,
  });
  const source = createCountyRiskSource({
    readLayers: () => layers,
    fetchImpl: lightningFetch(),
    now: () => nowMs,
  });
  const first = await source.getSnapshot();
  assert.equal(first.components.power.value, 40);
  // 30 minutes later, up to 1,500 — no hour-old reading yet, so no
  // "rising" bump: 60, not 80.
  nowMs = NOW + 30 * 60 * 1000;
  layers.outages.getStats = () => ({
    count: 1,
    customersOut: 1500,
    majorEvent: false,
    lastUpdate: nowMs,
  });
  const second = await source.getSnapshot();
  assert.equal(second.components.power.value, 60);
  // 61 minutes after the first reading, the 400 reading is now an
  // hour old: 1,500 > 400 → rising → 80.
  nowMs = NOW + 61 * 60 * 1000;
  layers.outages.getStats = () => ({
    count: 1,
    customersOut: 1500,
    majorEvent: false,
    lastUpdate: nowMs,
  });
  const third = await source.getSnapshot();
  assert.equal(third.components.power.value, 80);
});

test('an aborted signal throws before any work', async () => {
  const source = createCountyRiskSource({
    readLayers: calmLayers,
    fetchImpl: lightningFetch(),
    now: () => NOW,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => source.getSnapshot({ signal: controller.signal }));
});
