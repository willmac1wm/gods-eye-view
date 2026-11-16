import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  APRS_OVERLAY_SOURCE_ID,
  APRS_OVERLAY_COHORT_LIMIT,
  APRS_MARKER_COLORS,
  aprsMarkerColor,
  createAprsOverlayEntry,
  selectAprsOverlayCohort,
  mapAnalystRecord,
} from './model.js';
import { ANALYST_LAYERS } from '../../data/analystEngine.js';
import { voiceLayer } from '../../voice/layerManifest.js';

const position = Cesium.Cartesian3.fromDegrees(-74.82067, 39.19117);

const fresh = {
  callsign: 'KC2DUX',
  place: 'Eldora, Dennis Twp',
  lat: 39.19117,
  lon: -74.82067,
  timeMs: Date.now() - 60_000,
  tempC: 3,
  tempF: 37.4,
  humidity: 75,
  pressureMb: 1025.2,
  pressureInHg: 30.27,
  windDirDeg: 24,
  windSpeedMps: 0,
  windSpeedMph: 0,
  windGustMps: 1.8,
  windGustMph: 4,
  rain1hMm: 0,
  rain24hMm: 0,
  rainMnMm: 0,
  luminosity: null,
  ageMin: 1,
  stale: false,
  missing: false,
};

test('marker colors: fresh sky blue, stale grey, missing dark grey', () => {
  assert.equal(aprsMarkerColor(fresh), Cesium.Color.SKYBLUE);
  assert.equal(aprsMarkerColor({ ...fresh, stale: true }), Cesium.Color.GRAY);
  assert.equal(
    aprsMarkerColor({ ...fresh, missing: true }),
    Cesium.Color.DARKGRAY,
  );
  assert.deepEqual(APRS_MARKER_COLORS, {
    fresh: Cesium.Color.SKYBLUE,
    stale: Cesium.Color.GRAY,
    missing: Cesium.Color.DARKGRAY,
  });
});

test('overlay entry labels a fresh station with its temperature', () => {
  const entry = createAprsOverlayEntry({ id: 'KC2DUX', position, row: fresh });
  assert.equal(entry.id, 'KC2DUX');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'KC2DUX 37°F');
  assert.equal(entry.subtitle, null);
  assert.equal(entry.accent, Cesium.Color.SKYBLUE.toCssColorString());
  assert.equal(entry.priority, 1000);
  assert.equal(entry.interactive, false);
});

test('overlay entry dims stale stations and marks missing ones', () => {
  const stale = createAprsOverlayEntry({
    id: 'KC2DUX',
    position,
    row: { ...fresh, stale: true, ageMin: 90 },
  });
  assert.equal(stale.title, 'KC2DUX 37°F');
  assert.equal(stale.subtitle, 'STALE — last report 90 min ago');
  assert.equal(stale.accent, Cesium.Color.GRAY.toCssColorString());
  assert.equal(stale.priority, 100);

  const missing = createAprsOverlayEntry({
    id: 'KC2DUX',
    position,
    row: { ...fresh, missing: true, stale: true, tempF: null },
  });
  assert.equal(missing.title, 'KC2DUX —');
  assert.equal(missing.subtitle, 'not reporting');
  assert.equal(missing.accent, Cesium.Color.DARKGRAY.toCssColorString());
  assert.equal(missing.priority, 0);
});

test('cohort select keeps all six stations, fresh first', () => {
  const rows = [
    { ...fresh, callsign: 'A' },
    { ...fresh, callsign: 'B', stale: true },
    { ...fresh, callsign: 'C', missing: true, stale: true },
  ];
  const entries = rows.map((row) =>
    createAprsOverlayEntry({ id: row.callsign, position, row }),
  );
  const cohort = selectAprsOverlayCohort(entries);
  assert.deepEqual(
    cohort.map((entry) => entry.id),
    ['A', 'B', 'C'],
  );
  assert.equal(selectAprsOverlayCohort([], 0).length, 0);
  assert.equal(APRS_OVERLAY_COHORT_LIMIT, 8);
  assert.equal(APRS_OVERLAY_SOURCE_ID, 'aprs-weather');
});

test('analyst record mapping keeps stale and missing flags', () => {
  const record = mapAnalystRecord(fresh);
  assert.equal(record.id, 'KC2DUX');
  assert.equal(record.place, 'Eldora, Dennis Twp');
  assert.equal(record.tempF, 37.4);
  assert.equal(record.humidity, 75);
  assert.equal(record.pressureInHg, 30.27);
  assert.equal(record.windDirDeg, 24);
  assert.equal(record.windSpeedMph, 0);
  assert.equal(record.windGustMph, 4);
  assert.equal(record.rain24hMm, 0);
  assert.equal(record.stale, false);
  assert.equal(record.missing, false);
  assert.ok(Math.abs(record.lat - 39.19117) < 1e-9);
  assert.ok(Math.abs(record.lon - -74.82067) < 1e-9);

  const stale = mapAnalystRecord({ ...fresh, stale: true }, 3);
  assert.equal(stale.stale, true);
  assert.equal(mapAnalystRecord(null, 2).id, 'APRS-0002');
  assert.equal(mapAnalystRecord({}).missing, false);
});

test('aprs-weather is voice-toggleable but deliberately not analyst-queryable', () => {
  // The Realtime prompt ceiling (55,500 chars) had 59 chars of headroom
  // when this layer landed; a queryable layer costs ~205. The layer keeps
  // its toggle and aliases, and the analyst record shape below stays
  // complete so the query can be added if headroom is reclaimed.
  const entry = voiceLayer('aprs-weather');
  assert.ok(entry, 'aprs-weather is in the voice manifest');
  assert.equal(entry.toggle, true);
  assert.equal(entry.query, null);
  assert.match(entry.noQuery, /prompt budget/);
  assert.equal(ANALYST_LAYERS['aprs-weather'], undefined);
  const record = mapAnalystRecord(fresh);
  assert.equal(record.id, 'KC2DUX');
  assert.equal(record.tempF, 37.4);
  assert.equal(record.humidity, 75);
  assert.equal(record.pressureInHg, 30.27);
  assert.equal(record.windDirDeg, 24);
  assert.equal(record.windSpeedMph, 0);
  assert.equal(record.windGustMph, 4);
  assert.equal(record.rain24hMm, 0);
  assert.equal(record.stale, false);
  assert.equal(record.missing, false);
  assert.equal(typeof record.lat, 'number');
  assert.equal(typeof record.lon, 'number');
});
