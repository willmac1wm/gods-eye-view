// src/layers/vesselInfo/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBackgroundLinks,
  buildEquasisLink,
  buildMaritimeDatabaseLink,
  normalizeVesselBackground,
} from './records.js';

const RECORD = {
  mmsi: '368889000',
  name: 'USNS BIG HORN',
  imo: '8812162',
  callsign: 'NBIG',
  lat: 1.22904,
  lon: 103.42177,
  speedKts: 12,
  courseDeg: 288,
  shipType: 'Tanker',
  destination: '>SEA',
  lastPositionEpoch: 1_793_123_456_789,
};

test('background maps the AIS fields and both reference links', () => {
  const row = normalizeVesselBackground(RECORD);
  assert.equal(row.mmsi, '368889000');
  assert.equal(row.imo, '8812162');
  assert.equal(row.hasImo, true);
  assert.equal(row.name, 'USNS BIG HORN');
  assert.equal(row.callsign, 'NBIG');
  assert.equal(row.shipType, 'Tanker');
  assert.equal(row.destination, '>SEA');
  assert.equal(row.links.equasis, buildEquasisLink(RECORD));
  assert.equal(
    row.links.maritimeDatabase,
    buildMaritimeDatabaseLink(RECORD),
  );
});

test('both links are home pages — no deep link is guessed', () => {
  assert.equal(
    buildEquasisLink(RECORD),
    'https://www.equasis.org/EquasisWeb/public/HomePage',
  );
  assert.equal(
    buildMaritimeDatabaseLink(RECORD),
    'https://maritime-database.com/',
  );
  assert.deepEqual(buildBackgroundLinks(RECORD), {
    equasis: 'https://www.equasis.org/EquasisWeb/public/HomePage',
    maritimeDatabase: 'https://maritime-database.com/',
  });
});

test('no IMO broadcast means search by name, never unknown vessel', () => {
  const row = normalizeVesselBackground({ ...RECORD, imo: '' });
  assert.equal(row.imo, null);
  assert.equal(row.hasImo, false);
  assert.equal(row.name, 'USNS BIG HORN');
  assert.equal(row.links.equasis, buildEquasisLink(RECORD));
  const badImo = normalizeVesselBackground({ ...RECORD, imo: 'ABC' });
  assert.equal(badImo.imo, null);
  assert.equal(badImo.hasImo, false);
});

test('background needs an MMSI', () => {
  assert.equal(normalizeVesselBackground({ ...RECORD, mmsi: '' }), null);
  assert.equal(normalizeVesselBackground(null), null);
});
