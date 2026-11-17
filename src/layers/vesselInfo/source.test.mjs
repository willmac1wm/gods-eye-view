// src/layers/vesselInfo/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVesselInfoSource } from './source.js';

const RECORDS = [
  {
    mmsi: '368889000',
    name: 'USNS BIG HORN',
    imo: '8812162',
    lat: 1.23,
    lon: 103.42,
    speedKts: 12,
    shipType: 'Tanker',
    lastPositionEpoch: 1_793_123_456_789,
  },
  {
    mmsi: '367123456',
    name: 'SEA HARVEST',
    imo: '',
    lat: 39.1,
    lon: -74.9,
    speedKts: 4,
    shipType: '30',
    lastPositionEpoch: 1_793_123_456_789,
  },
  { mmsi: '', name: 'NO KEY', lat: 39.1, lon: -74.9, shipType: '30' },
];

test('getBackgrounds normalizes every vessel in the feed', () => {
  const source = createVesselInfoSource({
    vessels: { getAnalystRecords: () => RECORDS },
  });
  const { rows } = source.getBackgrounds();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].imo, '8812162');
  assert.equal(rows[0].hasImo, true);
  assert.equal(rows[1].imo, null);
  assert.equal(rows[1].hasImo, false);
  assert.equal(
    rows[1].links.equasis,
    'https://www.equasis.org/EquasisWeb/public/HomePage',
  );
});

test('getBackgrounds is empty, not an error, with no vessels', () => {
  const empty = createVesselInfoSource({
    vessels: { getAnalystRecords: () => [] },
  });
  assert.deepEqual(empty.getBackgrounds().rows, []);
  const absent = createVesselInfoSource({ vessels: null });
  assert.deepEqual(absent.getBackgrounds().rows, []);
  const throwing = createVesselInfoSource({
    vessels: {
      getAnalystRecords: () => {
        throw new Error('AIS down');
      },
    },
  });
  assert.deepEqual(throwing.getBackgrounds().rows, []);
});

test('getBackgrounds honors abort', () => {
  const source = createVesselInfoSource({
    vessels: { getAnalystRecords: () => RECORDS },
  });
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => source.getBackgrounds({ signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
