import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAlprAvoidanceSummaryEntry,
  getAnalystRecords,
  routeMidpoint,
  routeMinutes,
} from './model.js';

function snapshot(overrides = {}) {
  return {
    available: true,
    reason: null,
    a: { lat: 39.0, lon: -74.6 },
    b: { lat: 39.1, lon: -74.5 },
    routes: [
      {
        distanceM: 8500,
        durationS: 900,
        geometry: [
          [-74.6, 39.0],
          [-74.55, 39.0],
          [-74.5, 39.0],
        ],
        cameraCount: 1,
        cameraIds: ['alpr:1'],
        onRoute: [{ id: 'alpr:1', lat: 39.0, lon: -74.55, distanceM: 0 }],
      },
      {
        distanceM: 9200,
        durationS: 1200,
        geometry: [
          [-74.6, 39.1],
          [-74.55, 39.1],
          [-74.5, 39.1],
        ],
        cameraCount: 0,
        cameraIds: [],
        onRoute: [],
      },
    ],
    fastestIndex: 0,
    lowestIndex: 1,
    sameRoute: false,
    camerasConsidered: 1,
    alprAvailable: true,
    alprStale: false,
    alprSaturated: false,
    fetchedAt: 1,
    ...overrides,
  };
}

test('routeMinutes rounds to whole minutes and the midpoint is the middle point', () => {
  assert.equal(routeMinutes({ durationS: 900 }), 15);
  assert.equal(routeMinutes({ durationS: 930 }), 16);
  assert.deepEqual(routeMidpoint(snapshot().routes[0]), {
    lat: 39.0,
    lon: -74.55,
  });
  assert.equal(routeMidpoint(null), null);
});

test('the summary label compares fastest and lowest exposure', () => {
  const entry = createAlprAvoidanceSummaryEntry({ snapshot: snapshot() });
  assert.match(entry.title, /Fastest: 15 min · 1 known cameras/);
  assert.match(entry.title, /Lowest exposure: 20 min · 0 known cameras/);
  assert.ok(
    entry.details.some((detail) => detail.includes('Scored against 1 known cameras')),
  );
  assert.ok(
    entry.details.some((detail) => detail.includes('Lowest exposure costs 5 min more')),
  );
});

test('the summary label says so when the fastest route is also the lowest-exposure one', () => {
  const entry = createAlprAvoidanceSummaryEntry({
    snapshot: snapshot({ lowestIndex: 0, sameRoute: true }),
  });
  assert.match(entry.title, /also the lowest-exposure route/);
});

test('the summary label never claims zero cameras when the ALPR data is unavailable', () => {
  const entry = createAlprAvoidanceSummaryEntry({
    snapshot: snapshot({ alprAvailable: false, camerasConsidered: 0 }),
  });
  assert.match(entry.title, /camera data unavailable/);
  assert.ok(!entry.title.includes('0 known cameras'));
  assert.ok(
    entry.details.some((detail) =>
      detail.includes('Enable the ALPR layer to score exposure'),
    ),
  );
});

test('the summary label guides placement when there are no endpoints', () => {
  const entry = createAlprAvoidanceSummaryEntry({
    snapshot: { available: false, reason: 'no-endpoints' },
  });
  assert.match(entry.title, /Place A and B in Directions/);
});

test('analyst records are one row per route, one row when the routes are the same', () => {
  assert.equal(getAnalystRecords(snapshot()).length, 2);
  const same = getAnalystRecords(snapshot({ lowestIndex: 0, sameRoute: true }));
  assert.equal(same.length, 1);
  assert.equal(same[0].kind, 'fastest');
  assert.deepEqual(getAnalystRecords({ available: false }), []);
});
