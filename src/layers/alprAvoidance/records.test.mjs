import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceToPolylineM,
  haversineM,
  pickFastestAndLowest,
  pointToSegmentM,
  scoreRoute,
  scoreRoutes,
  validateSnapshot,
} from './records.js';

// A straight east–west route at lat 39.0, lon -74.6 → -74.5 (two segments).
const ROUTE = {
  distanceM: 8500,
  durationS: 900,
  geometry: [
    [-74.6, 39.0],
    [-74.55, 39.0],
    [-74.5, 39.0],
  ],
};

test('haversine matches the known metre-per-degree at this latitude', () => {
  const oneDegreeLat = haversineM(39.0, -74.6, 40.0, -74.6);
  assert.ok(oneDegreeLat > 111190 && oneDegreeLat < 111200, String(oneDegreeLat));
});

test('point-to-segment distance is the perpendicular, clamped to the ends', () => {
  // 55 m north of the first segment's midpoint.
  const near = pointToSegmentM(39.0005, -74.575, [-74.6, 39.0], [-74.55, 39.0]);
  assert.ok(near > 50 && near < 60, String(near));
  // Past the western end: the distance is to the endpoint, not the line.
  const past = pointToSegmentM(39.0, -74.61, [-74.6, 39.0], [-74.55, 39.0]);
  assert.ok(past > 850 && past < 870, String(past));
});

test('a camera counts within 90 m of the polyline and not beyond it', () => {
  const cameras = [
    { id: 'alpr:1', lat: 39.0, lon: -74.55 }, // on the line
    { id: 'alpr:2', lat: 39.0005, lon: -74.575 }, // ~55 m north
    { id: 'alpr:3', lat: 39.0009, lon: -74.575 }, // ~100 m north
  ];
  const scored = scoreRoute(ROUTE, cameras);
  assert.equal(scored.cameraCount, 2);
  assert.deepEqual(scored.cameraIds, ['alpr:1', 'alpr:2']);
});

test('a camera near a shared vertex counts once, not once per segment', () => {
  const scored = scoreRoute(ROUTE, [{ id: 'alpr:1', lat: 39.0, lon: -74.55 }]);
  assert.equal(scored.cameraCount, 1);
  assert.equal(scored.onRoute.length, 1);
});

test('cameras without coordinates are skipped, never scored', () => {
  const scored = scoreRoute(ROUTE, [
    { id: 'alpr:1', lat: null, lon: -74.55 },
    { id: 'alpr:2', lat: 39.0, lon: -74.55 },
  ]);
  assert.equal(scored.cameraCount, 1);
  assert.deepEqual(scored.cameraIds, ['alpr:2']);
});

test('distance to an empty polyline is infinite; a single point is haversine', () => {
  assert.equal(distanceToPolylineM(39.0, -74.6, []), Infinity);
  assert.equal(
    distanceToPolylineM(39.0, -74.6, [[-74.6, 39.0]]),
    0,
  );
});

test('pickFastestAndLowest ranks by duration, then by cameras with a duration tiebreak', () => {
  const scored = scoreRoutes(
    [
      { ...ROUTE, durationS: 900, geometry: ROUTE.geometry },
      { ...ROUTE, durationS: 1200, geometry: [[-74.6, 39.1], [-74.5, 39.1]] },
    ],
    [{ id: 'alpr:1', lat: 39.0, lon: -74.55 }],
  );
  assert.equal(scored[0].cameraCount, 1);
  assert.equal(scored[1].cameraCount, 0);
  const picked = pickFastestAndLowest(scored);
  assert.equal(picked.fastestIndex, 0);
  assert.equal(picked.lowestIndex, 1);
  assert.equal(picked.sameRoute, false);

  // Same route is both fastest and lowest-exposure.
  const one = pickFastestAndLowest([scored[0]]);
  assert.deepEqual(one, { fastestIndex: 0, lowestIndex: 0, sameRoute: true });
  assert.deepEqual(pickFastestAndLowest([]), {
    fastestIndex: -1,
    lowestIndex: -1,
    sameRoute: false,
  });
});

test('validateSnapshot accepts a scored snapshot and rejects a broken one', () => {
  const good = {
    available: true,
    routes: [],
    fastestIndex: 0,
    lowestIndex: 0,
    camerasConsidered: 2,
    alprAvailable: true,
    fetchedAt: 1,
  };
  assert.deepEqual(validateSnapshot(good), []);
  assert.ok(validateSnapshot(null).length > 0);
  assert.ok(validateSnapshot({ ...good, routes: 'nope' }).length > 0);
  assert.ok(validateSnapshot({ ...good, alprAvailable: 'yes' }).length > 0);
});
