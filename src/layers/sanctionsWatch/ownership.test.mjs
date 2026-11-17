// src/layers/sanctionsWatch/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSanctionsWatchLayer } from './index.js';
import { validateScreening } from './records.js';

const LIVE_CHECK_RAW = {
  imo: '9169067',
  vesselName: 'MSC MIA SUMMER II',
  sanctions: { status: 'GREEN', coverageComplete: true, coverageGaps: [] },
  ownership: { opacity: 'HIGH', score: 70 },
  vetting: { grade: 'C', score: 43, status: 'marginal' },
  checkedAt: '2026-11-17T03:19:09.016Z',
  fullReport: 'https://arcnautical.com/check?imo=9169067',
  tier: 'keyless',
};

// What createSanctionsSource returns for the live check above.
const LIVE_CHECK = validateScreening(LIVE_CHECK_RAW);

function harness({ source, vessels, now } = {}) {
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
  const layer = createSanctionsWatchLayer({
    source: source ?? {
      screenVessel: async () => LIVE_CHECK,
    },
    vessels: vessels ?? { getAnalystRecords: () => [] },
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
    now: now ?? (() => 1_793_123_456_789),
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, visible, cleared };
}

function speedingVessel(nowMs) {
  return {
    mmsi: '367123456',
    name: 'MSC MIA SUMMER II',
    imo: '9169067',
    lat: 39.0,
    lon: -74.8,
    speedKts: 35,
    courseDeg: 90,
    shipType: 'Cargo',
    destination: 'NEW YORK',
    lastPositionEpoch: nowMs,
  };
}

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const nowMs = 1_793_123_456_789;
    const h = harness({
      source: {
        screenVessel(imo, options) {
          signal = options.signal;
          return new Promise((done) => {
            resolve = done;
          });
        },
      },
      vessels: { getAnalystRecords: () => [speedingVessel(nowMs)] },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve(LIVE_CHECK);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('update publishes one label for a speeding vessel (live values)', async () => {
  const nowMs = 1_793_123_456_789;
  const h = harness({
    vessels: { getAnalystRecords: () => [speedingVessel(nowMs)] },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'sanctions-watch');
  assert.match(h.events[0][1][0].title, /MSC MIA SUMMER II · impossible-speed/);
  assert.match(h.events[0][1][0].subtitle, /No matches/);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().screened, 1);
  assert.equal(h.layer.getStats().matches, 0);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['sanctions-watch']);
  assert.deepEqual(h.visible.at(-1), ['sanctions-watch', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per flagged vessel', async () => {
  const nowMs = 1_793_123_456_789;
  const h = harness({
    vessels: { getAnalystRecords: () => [speedingVessel(nowMs)] },
  });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].mmsi, '367123456');
  assert.equal(records[0].imo, '9169067');
  assert.deepEqual(records[0].signals, ['impossible-speed']);
  assert.equal(records[0].sanctionsStatus, 'GREEN');
  assert.equal(records[0].vettingGrade, 'C');
  assert.equal(
    records[0].fullReport,
    'https://arcnautical.com/check?imo=9169067',
  );
  h.layer.destroy(h.viewer);
});

test('a vessel that stops reporting while others do is flagged silent', async () => {
  let nowMs = 1_793_123_456_789;
  let current = [
    {
      mmsi: '367123456',
      name: 'QUIET SHIP',
      imo: '9169067',
      lat: 39.0,
      lon: -74.8,
      speedKts: 12,
      lastPositionEpoch: nowMs,
    },
  ];
  const h = harness({
    vessels: { getAnalystRecords: () => current },
    now: () => nowMs,
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 0);
  nowMs += 7 * 3_600_000;
  current = [1, 2, 3].map((n) => ({
    mmsi: `11100000${n}`,
    name: `COVERAGE ${n}`,
    lat: 39.1,
    lon: -74.7,
    speedKts: 10,
    lastPositionEpoch: nowMs,
  }));
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  const records = h.layer.getAnalystRecords();
  assert.deepEqual(records[0].signals, ['silence']);
  assert.match(records[0].signalDetails[0], /Last seen 7 h ago/);
  h.layer.destroy(h.viewer);
});

test('a screening failure marks the source unavailable, not the vessel', async () => {
  const nowMs = 1_793_123_456_789;
  const h = harness({
    source: {
      screenVessel: async () => {
        throw new Error('ArcNautical 503');
      },
    },
    vessels: { getAnalystRecords: () => [speedingVessel(nowMs)] },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().screened, 0);
  assert.equal(h.layer.getStats().sourceUnavailable, true);
  h.layer.destroy(h.viewer);
});
