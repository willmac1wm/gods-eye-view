import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAprsWxSnapshot,
  APRS_STALE_MINUTES,
  celsiusToFahrenheit,
  metersPerSecondToMph,
  millibarToInchesHg,
  millimetersToInches,
} from './records.js';
import { APRS_STATIONS, aprsStationNames } from './stations.js';

// Fixture modeled on the real aprs.fi `what=wx` shape (metric, Unix-second
// `time`) as shaped by the /api/aprs proxy, with values from the live
// findu re-check 2026-11-16 ~03:34 UTC (KC2DUX 37 °F ≈ 3 °C, 75% RH,
// 1025.2 mb). NOW is fixed so staleness is deterministic.
const NOW = Date.parse('2026-11-16T03:30:00Z');

function entry(callsign, overrides = {}) {
  const base = {
    KC2DUX: {
      callsign: 'KC2DUX',
      place: 'Eldora, Dennis Twp',
      lat: 39.19117,
      lon: -74.82067,
      timeMs: NOW - 2 * 60_000,
      tempC: 3,
      humidity: 75,
      pressureMb: 1025.2,
      windDirDeg: 24,
      windSpeedMps: 0,
      windGustMps: 1.8,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
    DW8913: {
      callsign: 'DW8913',
      place: 'Sea Isle City',
      lat: 39.1535,
      lon: -74.69417,
      timeMs: NOW - 1 * 60_000,
      tempC: 3.9,
      humidity: 72,
      pressureMb: 1025.2,
      windDirDeg: 6,
      windSpeedMps: 0,
      windGustMps: 0.3,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
    FW2611: {
      callsign: 'FW2611',
      place: 'Ocean City',
      lat: 39.27967,
      lon: -74.5685,
      timeMs: NOW - 3 * 60_000,
      tempC: 5.6,
      humidity: 68,
      pressureMb: 1025.8,
      windDirDeg: 317,
      windSpeedMps: 1.8,
      windGustMps: 3.1,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
    K2GFM: {
      callsign: 'K2GFM',
      place: 'Egg Harbor Twp',
      lat: 39.3665,
      lon: -74.598,
      timeMs: NOW - 1 * 60_000,
      tempC: 3.9,
      humidity: 71,
      pressureMb: 1025.6,
      windDirDeg: 305,
      windSpeedMps: 0.4,
      windGustMps: 1.1,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
    CW8812: {
      callsign: 'CW8812',
      place: 'Northfield',
      lat: 39.36683,
      lon: -74.57117,
      timeMs: NOW - 4 * 60_000,
      tempC: 3.9,
      humidity: 72,
      pressureMb: 1021.2,
      windDirDeg: 0,
      windSpeedMps: 0,
      windGustMps: 0,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
    FW6400: {
      callsign: 'FW6400',
      place: 'Linwood',
      lat: 39.353375,
      lon: -74.567241,
      timeMs: NOW - 2 * 60_000,
      tempC: 4.4,
      humidity: 71,
      pressureMb: 1025.7,
      windDirDeg: 4,
      windSpeedMps: 0,
      windGustMps: 0.6,
      rain1hMm: 0,
      rain24hMm: 0,
      rainMnMm: 0,
      luminosity: null,
    },
  }[callsign];
  return { ...base, ...overrides };
}

function payload(stations) {
  return {
    fetchedAt: NOW,
    stale: false,
    ttlMs: 300000,
    count: stations.length,
    stations,
  };
}

const ALL = () =>
  payload(Object.keys({ KC2DUX: 1, DW8913: 1, FW2611: 1, K2GFM: 1, CW8812: 1, FW6400: 1 }).map((callsign) => entry(callsign)));

test('registry holds six live stations inside the operative box', () => {
  assert.equal(APRS_STATIONS.length, 6);
  assert.equal(
    aprsStationNames(),
    'KC2DUX,DW8913,FW2611,K2GFM,CW8812,FW6400',
  );
  for (const station of APRS_STATIONS) {
    assert.ok(station.lat >= 38.9 && station.lat <= 39.38, station.callsign);
    assert.ok(station.lon >= -75.15 && station.lon <= -74.55, station.callsign);
  }
  // DW5057 (Cape May Point) is deliberately absent: it read 48 °F against
  // 37–42 °F neighbors at the 2026-11-16 re-check (9 °F above the median).
  assert.ok(!APRS_STATIONS.some((s) => s.callsign === 'DW5057'));
  // KS2D is deliberately absent: live but its coordinates are unknown.
  assert.ok(!APRS_STATIONS.some((s) => s.callsign === 'KS2D'));
  assert.throws(() => aprsStationNames([]), /empty/);
  assert.throws(
    () =>
      aprsStationNames([
        ...APRS_STATIONS,
        ...APRS_STATIONS,
        ...APRS_STATIONS,
        ...APRS_STATIONS,
      ]),
    /batch limit/,
  );
});

test('valid six-station payload converts metric to imperial exactly', () => {
  const rows = normalizeAprsWxSnapshot(ALL(), { nowMs: NOW });
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.map((row) => row.callsign),
    ['KC2DUX', 'DW8913', 'FW2611', 'K2GFM', 'CW8812', 'FW6400'],
  );
  const kc2dux = rows[0];
  assert.equal(kc2dux.place, 'Eldora, Dennis Twp');
  assert.equal(kc2dux.timeMs, NOW - 2 * 60_000);
  assert.equal(kc2dux.tempC, 3);
  assert.equal(kc2dux.tempF, 37.4);
  assert.equal(kc2dux.humidity, 75);
  assert.equal(kc2dux.pressureMb, 1025.2);
  assert.equal(kc2dux.pressureInHg, 30.27);
  assert.equal(kc2dux.windDirDeg, 24);
  assert.equal(kc2dux.windSpeedMph, 0);
  assert.equal(kc2dux.windGustMph, 4);
  assert.equal(kc2dux.rain1hMm, 0);
  assert.equal(kc2dux.rain1hIn, 0);
  assert.equal(kc2dux.ageMin, 2);
  assert.equal(kc2dux.stale, false);
  assert.equal(kc2dux.missing, false);
  // 5.6 °C → 42.1 °F; 1.8 m/s → 4 mph; 3.1 m/s gust → 6.9 mph.
  assert.equal(rows[2].tempF, 42.1);
  assert.equal(rows[2].windSpeedMph, 4);
  assert.equal(rows[2].windGustMph, 6.9);
  assert.equal(celsiusToFahrenheit(-40), -40);
  assert.equal(metersPerSecondToMph(10), 22.4);
  assert.equal(millibarToInchesHg(1013.25), 29.92);
  assert.equal(millimetersToInches(25.4), 1);
});

test('missing optional fields become nulls and the row is kept', () => {
  const sparse = payload([
    entry('KC2DUX', {
      windGustMps: null,
      rain1hMm: null,
      rain24hMm: null,
      rainMnMm: null,
      luminosity: null,
    }),
  ]);
  const rows = normalizeAprsWxSnapshot(sparse, { nowMs: NOW });
  assert.equal(rows.length, 6);
  const kc2dux = rows[0];
  assert.equal(kc2dux.windGustMps, null);
  assert.equal(kc2dux.windGustMph, null);
  assert.equal(kc2dux.rain1hMm, null);
  assert.equal(kc2dux.rain1hIn, null);
  assert.equal(kc2dux.luminosity, null);
  assert.equal(kc2dux.missing, false);
  assert.equal(kc2dux.stale, false);
  // The other five registry stations are absent → missing rows.
  assert.ok(rows.slice(1).every((row) => row.missing && row.stale));
});

test('malformed payloads are rejected whole', () => {
  const malformed = [
    null,
    'nope',
    [],
    {},
    { stations: 'nope' },
    { stations: null },
    payload([entry('KC2DUX'), entry('KC2DUX')]),
    payload([entry('KC2DUX', { callsign: 'UNKNOWN' })]),
    payload([entry('KC2DUX', { lat: 91 })]),
    payload([entry('KC2DUX', { lon: -181 })]),
    payload([entry('KC2DUX', { lat: Number.NaN })]),
    payload([entry('KC2DUX', { tempC: -100 })]),
    payload([entry('KC2DUX', { tempC: 61 })]),
    payload([entry('KC2DUX', { pressureMb: 500 })]),
    payload([entry('KC2DUX', { pressureMb: 1101 })]),
    payload([entry('KC2DUX', { humidity: 140 })]),
    payload([entry('KC2DUX', { humidity: -1 })]),
    payload([entry('KC2DUX', { windDirDeg: 361 })]),
    payload([entry('KC2DUX', { windSpeedMps: -1 })]),
    payload([entry('KC2DUX', { windGustMps: -0.5 })]),
    payload([entry('KC2DUX', { rain1hMm: -1 })]),
    payload([entry('KC2DUX', { rain24hMm: -1 })]),
    payload([entry('KC2DUX', { luminosity: -1 })]),
    payload([entry('KC2DUX', { timeMs: -1 })]),
    payload(['not-an-object']),
    payload([entry('KC2DUX', { callsign: '' })]),
  ];
  for (const bad of malformed) {
    assert.equal(
      normalizeAprsWxSnapshot(bad, { nowMs: NOW }),
      null,
      JSON.stringify(bad)?.slice(0, 120),
    );
  }
});

test('staleness: 61 min is stale, 30 min is fresh, undated is missing', () => {
  assert.equal(APRS_STALE_MINUTES, 60);
  const rows = normalizeAprsWxSnapshot(
    payload([
      entry('KC2DUX', { timeMs: NOW - 61 * 60_000 }),
      entry('DW8913', { timeMs: NOW - 30 * 60_000 }),
      entry('FW2611', { timeMs: NOW - 60 * 60_000 }),
      entry('K2GFM', { timeMs: null }),
    ]),
    { nowMs: NOW },
  );
  assert.equal(rows[0].stale, true);
  assert.equal(rows[0].missing, false);
  assert.equal(rows[0].ageMin, 61);
  assert.equal(rows[1].stale, false);
  assert.equal(rows[1].ageMin, 30);
  // Exactly 60 min is not yet past the threshold.
  assert.equal(rows[2].stale, false);
  assert.equal(rows[2].ageMin, 60);
  // Undated entry: not reporting, values not carried.
  assert.equal(rows[3].stale, true);
  assert.equal(rows[3].missing, true);
  assert.equal(rows[3].tempC, null);
  assert.equal(rows[3].ageMin, null);
  // Absent station → row present with missing:true.
  assert.equal(rows[4].callsign, 'CW8812');
  assert.equal(rows[4].missing, true);
  assert.equal(rows[4].stale, true);
});

test('empty upstream entries keep all six rows as missing, not null', () => {
  const rows = normalizeAprsWxSnapshot(payload([]), { nowMs: NOW });
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.missing && row.stale));
  assert.ok(rows.every((row) => row.timeMs === null));
});
