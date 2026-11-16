import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GPSJAM_MIN_AIRCRAFT,
  gpsjamIntegrityLevel,
  normalizeGpsjamCell,
  normalizeGpsjamSnapshot,
} from './records.js';

const boundary = [
  [-74.655086, 39.503507],
  [-74.958634, 39.450412],
  [-75.047572, 39.234937],
  [-74.835067, 39.073298],
  [-74.533806, 39.125839],
  [-74.442775, 39.340569],
];

const cell = (overrides = {}) => ({
  hex: '842aad9ffffffff',
  lat: 39.288,
  lon: -74.745,
  boundary,
  good: 726,
  bad: 0,
  total: 726,
  percent: 0,
  level: 'low',
  ...overrides,
});

const payload = (overrides = {}) => ({
  date: '2026-11-15',
  source: 'merged',
  suspect: false,
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 21_600_000,
  worldRows: 48208,
  count: 2,
  cells: [
    cell(),
    cell({
      hex: '842aad7ffffffff',
      lat: 38.752,
      lon: -75.522,
      good: 514,
      bad: 1,
      total: 515,
    }),
  ],
  ...overrides,
});

test('gpsjamIntegrityLevel discounts the first bad aircraft, then applies the 2/10 bands', () => {
  assert.deepEqual(gpsjamIntegrityLevel(726, 0), {
    percent: 0,
    level: 'low',
    state: 'nominal',
    interpretation: null,
  });
  assert.deepEqual(gpsjamIntegrityLevel(21, 2), {
    percent: 4.8,
    level: 'medium',
    state: 'navigation-integrity-anomaly',
    interpretation: 'suspected-gnss-interference',
  });
  assert.deepEqual(gpsjamIntegrityLevel(9, 3), {
    percent: 22.2,
    level: 'high',
    state: 'navigation-integrity-anomaly',
    interpretation: 'suspected-gnss-interference',
  });
  assert.deepEqual(gpsjamIntegrityLevel(50, 2).level, 'medium');
  assert.deepEqual(gpsjamIntegrityLevel(0, 0).level, 'low');
});

test('normalizeGpsjamCell keeps a valid cell and re-derives its level', () => {
  // A proxy that claimed "high" for a clean cell is corrected here.
  const row = normalizeGpsjamCell(cell({ level: 'high', percent: 99 }));
  assert.equal(row.level, 'low');
  assert.equal(row.percent, 0);
  assert.equal(row.total, 726);
  assert.equal(row.state, 'nominal');
  assert.equal(row.interpretation, null);
  assert.deepEqual(row.boundary, boundary);
  const medium = normalizeGpsjamCell(cell({ good: 19, bad: 2, total: 21 }));
  assert.equal(medium.level, 'medium');
  assert.equal(medium.percent, 4.8);
  assert.equal(medium.state, 'navigation-integrity-anomaly');
  assert.equal(medium.interpretation, 'suspected-gnss-interference');
});

test('normalizeGpsjamCell drops sparse, malformed and out-of-shape cells', () => {
  assert.equal(normalizeGpsjamCell(null), null);
  assert.equal(normalizeGpsjamCell({}), null);
  assert.equal(normalizeGpsjamCell(cell({ hex: 'not-a-hex' })), null);
  assert.equal(normalizeGpsjamCell(cell({ hex: '842AAD9FFFFFFFF' })), null);
  assert.equal(normalizeGpsjamCell(cell({ lat: '39.288' })), null);
  assert.equal(normalizeGpsjamCell(cell({ lon: 200 })), null);
  assert.equal(normalizeGpsjamCell(cell({ boundary: [] })), null);
  assert.equal(
    normalizeGpsjamCell(cell({ boundary: boundary.slice(0, 2) })),
    null,
  );
  assert.equal(
    normalizeGpsjamCell(
      cell({
        boundary: [
          [-74.6, 39.5],
          ['x', 39.4],
          [-75.0, 39.2],
        ],
      }),
    ),
    null,
  );
  assert.equal(normalizeGpsjamCell(cell({ good: -1 })), null);
  assert.equal(normalizeGpsjamCell(cell({ bad: 1.5 })), null);
  // Fewer than the minimum aircraft: a 0/1 row and a 1/1 row are not evidence.
  assert.equal(normalizeGpsjamCell(cell({ good: 0, bad: 1 })), null);
  assert.equal(normalizeGpsjamCell(cell({ good: 1, bad: 1 })), null);
  assert.ok(normalizeGpsjamCell(cell({ good: 2, bad: 1 })));
  assert.equal(GPSJAM_MIN_AIRCRAFT, 3);
});

test('normalizeGpsjamSnapshot validates the date and dedupes by hex', () => {
  const snapshot = normalizeGpsjamSnapshot(payload());
  assert.equal(snapshot.date, '2026-11-15');
  assert.equal(snapshot.source, 'merged');
  assert.equal(snapshot.suspect, false);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.fetchedAt, 1_793_123_456_789);
  assert.equal(snapshot.cells.length, 2);
  assert.deepEqual(snapshot.counts, { low: 2, medium: 0, high: 0 });
  assert.equal(snapshot.totalAircraft, 726 + 515);
  assert.equal(snapshot.totalBad, 1);
  assert.deepEqual(
    snapshot.cells.map((row) => row.hex),
    ['842aad7ffffffff', '842aad9ffffffff'],
  );

  const dupes = normalizeGpsjamSnapshot(
    payload({ cells: [cell(), cell(), cell({ hex: '842aad7ffffffff' })] }),
  );
  assert.equal(dupes.cells.length, 2);

  assert.equal(normalizeGpsjamSnapshot(null), null);
  assert.equal(normalizeGpsjamSnapshot([]), null);
  assert.equal(normalizeGpsjamSnapshot(payload({ date: '15 Nov 2026' })), null);
  assert.equal(normalizeGpsjamSnapshot(payload({ date: null })), null);
  assert.equal(normalizeGpsjamSnapshot(payload({ cells: 'nope' })), null);
  assert.equal(normalizeGpsjamSnapshot(payload({ cells: [] })).cells.length, 0);
});

test('normalizeGpsjamSnapshot carries the suspect flag and a missing source', () => {
  const suspect = normalizeGpsjamSnapshot(
    payload({ suspect: true, source: null }),
  );
  assert.equal(suspect.suspect, true);
  assert.equal(suspect.source, null);
  const noFlag = normalizeGpsjamSnapshot(payload({ suspect: 'yes' }));
  assert.equal(noFlag.suspect, false);
  const stale = normalizeGpsjamSnapshot(payload({ stale: true }));
  assert.equal(stale.stale, true);
});
