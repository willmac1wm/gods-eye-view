import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POSITION_SOURCE,
  normalizePositionSource,
  positionSourceLabel,
  isBadgedPositionSource,
  readsbPositionSource,
  countPositionSources,
  formatPositionSourceCounts,
} from './positionSource.js';

test('position source normalizes the four OpenSky codes and rejects the rest', () => {
  assert.equal(normalizePositionSource(0), 0);
  assert.equal(normalizePositionSource(1), 1);
  assert.equal(normalizePositionSource(2), 2);
  assert.equal(normalizePositionSource(3), 3);
  assert.equal(normalizePositionSource('2'), 2);
  assert.equal(normalizePositionSource(2.0), 2);
  assert.equal(normalizePositionSource(null), null);
  assert.equal(normalizePositionSource(undefined), null);
  assert.equal(normalizePositionSource(''), null);
  assert.equal(normalizePositionSource(true), null);
  assert.equal(normalizePositionSource(4), null);
  assert.equal(normalizePositionSource(-1), null);
  assert.equal(normalizePositionSource(2.5), null);
  assert.equal(normalizePositionSource('mlat'), null);
  assert.equal(normalizePositionSource(Number.NaN), null);
  assert.deepEqual(POSITION_SOURCE, {
    ADS_B: 0,
    ASTERIX: 1,
    MLAT: 2,
    FLARM: 3,
  });
});

test('position source labels name each source and stay null when unknown', () => {
  assert.equal(positionSourceLabel(0), 'ADS-B');
  assert.equal(positionSourceLabel(1), 'ASTERIX');
  assert.equal(positionSourceLabel(2), 'MLAT');
  assert.equal(positionSourceLabel(3), 'FLARM');
  assert.equal(positionSourceLabel(null), null);
  assert.equal(positionSourceLabel(9), null);
});

test('only MLAT and FLARM aircraft get the ring badge', () => {
  assert.equal(isBadgedPositionSource(0), false);
  assert.equal(isBadgedPositionSource(1), false);
  assert.equal(isBadgedPositionSource(2), true);
  assert.equal(isBadgedPositionSource(3), true);
  assert.equal(isBadgedPositionSource(null), false);
  assert.equal(isBadgedPositionSource(4), false);
});

test('readsb types map MLAT and ADS-B, and nothing else is assumed', () => {
  assert.equal(readsbPositionSource('mlat'), 2);
  assert.equal(readsbPositionSource('MLAT'), 2);
  assert.equal(readsbPositionSource('adsb_icao'), 0);
  assert.equal(readsbPositionSource('adsb_other'), 0);
  assert.equal(readsbPositionSource('tisb'), null);
  assert.equal(readsbPositionSource(''), null);
  assert.equal(readsbPositionSource(null), null);
  assert.equal(readsbPositionSource(undefined), null);
});

test('per-source counts tally every contact once and bucket unknowns', () => {
  assert.deepEqual(countPositionSources([0, 0, 1, 2, 2, 3, null, 9]), {
    total: 8,
    adsb: 2,
    asterix: 1,
    mlat: 2,
    flarm: 1,
    unknown: 2,
  });
  assert.deepEqual(countPositionSources([]), {
    total: 0,
    adsb: 0,
    asterix: 0,
    mlat: 0,
    flarm: 0,
    unknown: 0,
  });
  assert.deepEqual(countPositionSources(null), {
    total: 0,
    adsb: 0,
    asterix: 0,
    mlat: 0,
    flarm: 0,
    unknown: 0,
  });
});

test('status line names only non-zero non-ADS-B sources', () => {
  assert.equal(
    formatPositionSourceCounts({
      total: 1204,
      adsb: 1191,
      asterix: 0,
      mlat: 11,
      flarm: 2,
      unknown: 0,
    }),
    '1,204 aircraft · 11 MLAT · 2 FLARM',
  );
  assert.equal(
    formatPositionSourceCounts({
      total: 50,
      adsb: 48,
      asterix: 1,
      mlat: 0,
      flarm: 0,
      unknown: 1,
    }),
    '50 aircraft · 1 ASTERIX · 1 unknown source',
  );
  assert.equal(
    formatPositionSourceCounts({
      total: 3,
      adsb: 3,
      asterix: 0,
      mlat: 0,
      flarm: 0,
      unknown: 0,
    }),
    '3 aircraft',
  );
  assert.equal(formatPositionSourceCounts({ total: 0 }), null);
  assert.equal(formatPositionSourceCounts(null), null);
});
