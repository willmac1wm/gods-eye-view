import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAnalystRecord } from './model.js';
import { normalizeGpsjamSnapshot } from './records.js';

const row = {
  hex: '842aad9ffffffff',
  lat: 39.288,
  lon: -74.745,
  boundary: [
    [-74.655086, 39.503507],
    [-74.958634, 39.450412],
    [-75.047572, 39.234937],
    [-74.835067, 39.073298],
    [-74.533806, 39.125839],
    [-74.442775, 39.340569],
  ],
  good: 726,
  bad: 0,
  total: 726,
  percent: 0,
  level: 'low',
  state: 'nominal',
  interpretation: null,
};

test('mapAnalystRecord maps one cell, positioned at its centroid', () => {
  const record = mapAnalystRecord(
    { ...row, date: '2026-11-15', source: 'merged', hasPosition: true },
    0,
  );
  assert.equal(record.id, 'gpsjam-daily:842aad9ffffffff');
  assert.equal(record.hex, '842aad9ffffffff');
  assert.equal(record.date, '2026-11-15');
  assert.equal(record.source, 'merged');
  assert.equal(record.lat, 39.288);
  assert.equal(record.lon, -74.745);
  assert.equal(record.hasPosition, true);
  assert.equal(record.level, 'low');
  assert.equal(record.percent, 0);
  assert.equal(record.aircraft, 726);
  assert.equal(record.degraded, 0);
  assert.equal(record.state, 'nominal');
  assert.equal(record.interpretation, null);
});

test('mapAnalystRecord falls back to an index id without a hex', () => {
  const record = mapAnalystRecord({}, 3);
  assert.equal(record.id, 'gpsjam-daily-0003');
  assert.equal(record.hex, null);
  assert.equal(record.hasPosition, false);
});

test('a normalized snapshot round-trips through the analyst seam', () => {
  const snapshot = normalizeGpsjamSnapshot({
    date: '2026-11-15',
    source: 'merged',
    suspect: false,
    cells: [{ ...row, good: 6, bad: 3, total: 9 }],
  });
  assert.equal(snapshot.cells.length, 1);
  assert.equal(snapshot.cells[0].level, 'high');
  const record = mapAnalystRecord({
    ...snapshot.cells[0],
    date: snapshot.date,
    source: snapshot.source,
    hasPosition: true,
  });
  assert.equal(record.level, 'high');
  assert.equal(record.percent, 22.2);
  assert.equal(record.interpretation, 'suspected-gnss-interference');
});
