import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DROUGHT_CATEGORIES,
  categoryAtPoint,
  countyDrought,
  geometryContainsPoint,
  pointInRing,
  validateDroughtSnapshot,
} from './records.js';
import { COUNTY_SAMPLE_POINTS } from './policy.js';

// Fixture polygons: a D0 square around the county seat, a D1 square over
// the northwest corner of the county bbox. (Live map 2026-11-16: the
// county seat is in the real D0 polygon and nowhere else.)
const D0_SQUARE = [
  [-75.1, 38.95],
  [-74.7, 38.95],
  [-74.7, 39.2],
  [-75.1, 39.2],
  [-75.1, 38.95],
];
const D1_SQUARE = [
  [-75.2, 39.25],
  [-74.95, 39.25],
  [-74.95, 39.4],
  [-75.2, 39.4],
  [-75.2, 39.25],
];

const FEATURES = [
  {
    type: 'Feature',
    properties: { DM: 0 },
    geometry: { type: 'MultiPolygon', coordinates: [[D0_SQUARE]] },
  },
  {
    type: 'Feature',
    properties: { DM: 1 },
    geometry: { type: 'Polygon', coordinates: [D1_SQUARE] },
  },
];

test('pointInRing classifies inside/outside a square', () => {
  assert.equal(pointInRing({ lat: 39.08, lon: -74.9 }, D0_SQUARE), true);
  assert.equal(pointInRing({ lat: 39.4, lon: -74.9 }, D0_SQUARE), false);
  assert.equal(pointInRing({ lat: 39.08, lon: -74.9 }, D1_SQUARE), false);
});

test('geometryContainsPoint handles Polygon, MultiPolygon and holes', () => {
  assert.equal(
    geometryContainsPoint({ type: 'Polygon', coordinates: [D1_SQUARE] }, { lat: 39.3, lon: -75.05 }),
    true,
  );
  assert.equal(
    geometryContainsPoint(
      { type: 'MultiPolygon', coordinates: [[D0_SQUARE]] },
      { lat: 39.08, lon: -74.9 },
    ),
    true,
  );
  // A hole cut out of the D0 square excludes its interior.
  const holed = {
    type: 'Polygon',
    coordinates: [
      D0_SQUARE,
      [
        [-74.95, 39.0],
        [-74.85, 39.0],
        [-74.85, 39.1],
        [-74.95, 39.1],
        [-74.95, 39.0],
      ],
    ],
  };
  assert.equal(geometryContainsPoint(holed, { lat: 39.05, lon: -74.9 }), false);
  assert.equal(geometryContainsPoint(holed, { lat: 39.15, lon: -74.9 }), true);
  assert.equal(geometryContainsPoint({ type: 'Point' }, { lat: 39.08, lon: -74.9 }), false);
});

test('categoryAtPoint returns D0 at the county seat (live result)', () => {
  assert.equal(
    categoryAtPoint(FEATURES, { lat: 39.08, lon: -74.9 }),
    0,
  );
  assert.equal(categoryAtPoint(FEATURES, { lat: 39.3, lon: -75.05 }), 1);
  assert.equal(categoryAtPoint(FEATURES, { lat: 40.22, lon: -74.76 }), null);
  assert.equal(categoryAtPoint([], { lat: 39.08, lon: -74.9 }), null);
});

test('countyDrought takes the worst category across the sample points', () => {
  const result = countyDrought(FEATURES, COUNTY_SAMPLE_POINTS);
  assert.equal(result.category, 1);
  assert.equal(result.categories.length, COUNTY_SAMPLE_POINTS.length);
  const seat = result.categories.find(
    (entry) => entry.point.lat === 39.08 && entry.point.lon === -74.9,
  );
  assert.equal(seat.category, 0);
  const noDrought = countyDrought([], COUNTY_SAMPLE_POINTS);
  assert.equal(noDrought.category, null);
});

test('the category table names all five USDM levels', () => {
  assert.equal(DROUGHT_CATEGORIES[0].code, 'D0');
  assert.equal(DROUGHT_CATEGORIES[0].name, 'Abnormally Dry');
  assert.equal(DROUGHT_CATEGORIES[4].code, 'D4');
  assert.equal(DROUGHT_CATEGORIES[4].name, 'Exceptional Drought');
});

test('validateDroughtSnapshot accepts D0 and no-drought, rejects bad categories', () => {
  const base = { fetchedAt: 1, releasedAt: 'Thu, 12 Nov 2026 11:15:51 GMT', stale: false, categories: [] };
  assert.deepEqual(validateDroughtSnapshot({ ...base, category: 0 }), { ...base, category: 0 });
  assert.deepEqual(validateDroughtSnapshot({ ...base, category: null }), { ...base, category: null });
  assert.throws(
    () => validateDroughtSnapshot({ ...base, category: 5 }),
    /invalid snapshot/,
  );
  assert.throws(
    () => validateDroughtSnapshot({ ...base, category: 0, stale: 'no' }),
    /invalid snapshot/,
  );
});
