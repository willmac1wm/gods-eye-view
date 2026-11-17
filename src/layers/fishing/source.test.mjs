// src/layers/fishing/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFishingSource } from './source.js';

const RECORDS = [
  {
    mmsi: '367123456',
    name: 'SEA HARVEST',
    lat: 39.1,
    lon: -74.9,
    speedKts: 4.2,
    shipType: '30',
    lastPositionEpoch: 1_793_123_456_789,
  },
  {
    mmsi: '367999999',
    name: 'TOW BOAT',
    lat: 39.1,
    lon: -74.9,
    speedKts: 6,
    shipType: '31',
    lastPositionEpoch: 1_793_123_456_789,
  },
  {
    mmsi: '367111111',
    name: 'FAR FISHER',
    lat: 40.0,
    lon: -74.9,
    speedKts: 5,
    shipType: '30',
    lastPositionEpoch: 1_793_123_456_789,
  },
];

test('getPresence keeps only fishing vessels in the box', () => {
  const source = createFishingSource({
    vessels: { getAnalystRecords: () => RECORDS },
  });
  const presence = source.getPresence();
  assert.equal(presence.vessels.length, 1);
  assert.equal(presence.vessels[0].mmsi, '367123456');
  assert.match(presence.links.gfwMap, /globalfishingwatch\.org\/map\//);
});

test('getPresence is empty, not an error, with no vessels or none fishing', () => {
  const empty = createFishingSource({
    vessels: { getAnalystRecords: () => [] },
  });
  assert.deepEqual(empty.getPresence().vessels, []);
  const absent = createFishingSource({ vessels: null });
  assert.deepEqual(absent.getPresence().vessels, []);
  const throwing = createFishingSource({
    vessels: {
      getAnalystRecords: () => {
        throw new Error('AIS down');
      },
    },
  });
  assert.deepEqual(throwing.getPresence().vessels, []);
});

test('getPresence honors abort', () => {
  const source = createFishingSource({
    vessels: { getAnalystRecords: () => RECORDS },
  });
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => source.getPresence({ signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
