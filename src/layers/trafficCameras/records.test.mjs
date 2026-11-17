import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeTrafficCameras,
  normalizeTrafficCamera,
  validateTrafficSnapshot,
} from './records.js';

// NJ511 row shape (server/providers/nj511.js mapNj511Camera).
const NJ511_ROW = {
  name: 'NJ 47 @ County Rd 610',
  image_url: 'https://511nj.org/api/camera/123/image',
  road: 'NJ 47',
  lat: 39.0827,
  lng: -74.82,
  heading: null,
  fov: 60,
  heading_confidence: 'estimated',
  source: '511NJ',
  extra: { id: 123 },
};

// DelDOT TMC row shape (server/providers/deldot.js parseTmcCameras).
const DELDOT_ROW = {
  name: 'US 9 @ Lewes Ferry Terminal',
  image_url: 'https://tmc.deldot.gov/video/abc.m3u8',
  road: 'US 9',
  lat: 38.9558,
  lng: -75.1436,
  heading: 180,
  fov: 60,
  heading_confidence: 'high',
  source: 'DelDOT TMC',
  extra: { county: 'Sussex', id: 'abc' },
};

// DRBA ferry-webcam seed row (server/providers/deldot.js ferryTrafficSeed).
const FERRY_ROW = {
  name: 'Cape May Ferry Terminal',
  image_url: 'https://example.invalid/ferry.jpg',
  player_url: null,
  stream_url: null,
  road: 'Ferry Terminal',
  lat: 38.9336,
  lng: -74.9608,
  heading: null,
  fov: 60,
  heading_confidence: 'high',
  source: 'DRBA',
  extra: { city: 'Cape May' },
};

test('normalizeTrafficCamera keeps the NJ511 row with a stable id', () => {
  const row = normalizeTrafficCamera(NJ511_ROW);
  assert.equal(row.id, '511NJ:123');
  assert.equal(row.name, 'NJ 47 @ County Rd 610');
  assert.equal(row.road, 'NJ 47');
  assert.equal(row.lat, 39.0827);
  assert.equal(row.lng, -74.82);
  assert.equal(row.heading, null);
  assert.equal(row.source, '511NJ');
});

test('normalizeTrafficCamera keeps the DelDOT row with heading and stream', () => {
  const row = normalizeTrafficCamera(DELDOT_ROW);
  assert.equal(row.id, 'DelDOT TMC:abc');
  assert.equal(row.heading, 180);
  assert.equal(row.imageUrl, 'https://tmc.deldot.gov/video/abc.m3u8');
});

test('normalizeTrafficCamera ids a row without an extra id by coordinates', () => {
  const row = normalizeTrafficCamera(FERRY_ROW);
  assert.equal(row.id, 'DRBA:38.93360,-74.96080');
  assert.equal(row.headingConfidence, 'high');
});

test('normalizeTrafficCamera drops rows without valid coordinates', () => {
  assert.equal(normalizeTrafficCamera(null), null);
  assert.equal(normalizeTrafficCamera({ ...NJ511_ROW, lat: null }), null);
  assert.equal(normalizeTrafficCamera({ ...NJ511_ROW, lng: 181 }), null);
  assert.equal(normalizeTrafficCamera({ ...NJ511_ROW, lat: 'north' }), null);
});

test('mergeTrafficCameras dedupes by id with NJ511 winning', () => {
  const merged = mergeTrafficCameras(
    [NJ511_ROW, { ...NJ511_ROW, extra: { id: 123 }, name: 'NJ 47 (new name)' }],
    [DELDOT_ROW, FERRY_ROW],
  );
  assert.equal(merged.records.length, 3);
  assert.equal(merged.nj511Count, 2);
  assert.equal(merged.deldotCount, 2);
  const nj = merged.records.find((row) => row.id === '511NJ:123');
  assert.equal(nj.name, 'NJ 47 (new name)');
});

test('mergeTrafficCameras tolerates a missing half', () => {
  const merged = mergeTrafficCameras(null, [FERRY_ROW]);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.nj511Count, 0);
});

test('validateTrafficSnapshot accepts a merged snapshot and rejects a thin one', () => {
  const snapshot = {
    fetchedAt: 1,
    stale: false,
    nj511Configured: false,
    records: [normalizeTrafficCamera(FERRY_ROW)],
    nj511Count: 0,
    deldotCount: 1,
  };
  assert.equal(validateTrafficSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateTrafficSnapshot({ ...snapshot, nj511Configured: 'no' }),
    /invalid snapshot/,
  );
  assert.throws(
    () =>
      validateTrafficSnapshot({
        ...snapshot,
        records: [normalizeTrafficCamera(FERRY_ROW), normalizeTrafficCamera(FERRY_ROW)],
      }),
    /invalid record/,
  );
});
