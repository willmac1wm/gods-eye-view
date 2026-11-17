import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOpenSkyAircraft,
  normalizeReadsbAircraft,
  openSkySnapshot,
} from './aircraft.js';

// OpenSky /states/all: [icao24, callsign, origin_country, time_position,
// last_contact, lon, lat, baro_alt, on_ground, velocity, true_track,
// vertical_rate, sensors, geo_alt, squawk, spi, position_source, category].
const row = (fields = {}) => [
  'a1b2c3',
  'SWA696  ',
  'United States',
  1700000000,
  1700000003,
  -97.67,
  30.19,
  10000,
  false,
  200,
  90,
  0,
  null,
  10200,
  '1200',
  false,
  0,
  4,
].map((value, index) =>
  Object.hasOwn(fields, index) ? fields[index] : value,
);

test('openSky normalizer carries position_source 0/1/2/3', () => {
  assert.equal(normalizeOpenSkyAircraft(row({ 16: 0 })).positionSource, 0);
  assert.equal(normalizeOpenSkyAircraft(row({ 16: 1 })).positionSource, 1);
  assert.equal(normalizeOpenSkyAircraft(row({ 16: 2 })).positionSource, 2);
  assert.equal(normalizeOpenSkyAircraft(row({ 16: 3 })).positionSource, 3);
});

test('openSky normalizer reads a missing or unknown position_source as null', () => {
  assert.equal(normalizeOpenSkyAircraft(row({ 16: null })).positionSource, null);
  assert.equal(
    normalizeOpenSkyAircraft(row({ 16: undefined })).positionSource,
    null,
  );
  assert.equal(normalizeOpenSkyAircraft(row({ 16: 9 })).positionSource, null);
  const short = row();
  short.length = 16;
  assert.equal(normalizeOpenSkyAircraft(short).positionSource, null);
});

test('openSky snapshot passes position_source through and still rejects unpositioned rows', () => {
  const snapshot = openSkySnapshot(
    {
      time: 1700000006,
      states: [
        row({ 16: 2 }),
        row({ 0: 'c3d4e5', 16: 3 }),
        ['deadbe', null, null, null, null, null, null],
      ],
    },
    { now: 1700000006000 },
  );
  assert.deepEqual(
    snapshot.records.map((record) => record.positionSource),
    [2, 3],
  );
  assert.equal(snapshot.records[0].id, 'a1b2c3');
  assert.deepEqual([...snapshot.retainIds], ['deadbe']);
});

test('readsb normalizer maps type mlat to MLAT and adsb types to ADS-B', () => {
  const base = {
    hex: 'A1B2C3',
    lat: 30,
    lon: -97,
    alt_baro: 10000,
    flight: 'SWA696',
  };
  assert.equal(
    normalizeReadsbAircraft({ ...base, type: 'mlat' }, 1700000000000)
      .positionSource,
    2,
  );
  assert.equal(
    normalizeReadsbAircraft({ ...base, type: 'adsb_icao' }, 1700000000000)
      .positionSource,
    0,
  );
  assert.equal(
    normalizeReadsbAircraft({ ...base, type: 'adsb_other' }, 1700000000000)
      .positionSource,
    0,
  );
  assert.equal(
    normalizeReadsbAircraft({ ...base }, 1700000000000).positionSource,
    null,
  );
  assert.equal(
    normalizeReadsbAircraft({ ...base, type: 'tisb' }, 1700000000000)
      .positionSource,
    null,
  );
});
