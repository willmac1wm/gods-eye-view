import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  SATNOGS_OVERLAY_SOURCE_ID,
  SATNOGS_OVERLAY_COHORT_LIMIT,
  SATNOGS_OVERLAY_COLLISION_CAPACITY,
  satnogsStationColor,
  createSatnogsOverlayEntry,
  selectSatnogsOverlayCohort,
  mapAnalystRecord,
} from './model.js';

test('overlay constants match the layer id and cohort size', () => {
  assert.equal(SATNOGS_OVERLAY_SOURCE_ID, 'satnogs');
  assert.equal(SATNOGS_OVERLAY_COHORT_LIMIT, 8);
  assert.equal(SATNOGS_OVERLAY_COLLISION_CAPACITY, 4);
});

test('station color is cyan when heard, grey when quiet', () => {
  assert.equal(
    satnogsStationColor({ completedCount: 12 }).toCssColorString(),
    Cesium.Color.CYAN.toCssColorString(),
  );
  assert.equal(
    satnogsStationColor({ completedCount: 0 }).toCssColorString(),
    Cesium.Color.GRAY.toCssColorString(),
  );
  assert.equal(
    satnogsStationColor({}).toCssColorString(),
    Cesium.Color.GRAY.toCssColorString(),
  );
  assert.equal(
    satnogsStationColor(null).toCssColorString(),
    Cesium.Color.GRAY.toCssColorString(),
  );
});

test('overlay entries label the station with heard/scheduled counts', () => {
  const position = Cesium.Cartesian3.fromDegrees(-75.21, 39.716);
  const entry = createSatnogsOverlayEntry({
    id: '223',
    position,
    station: {
      name: 'W2MMD GCARC Clubhouse',
      completedCount: 12,
      scheduledCount: 3,
      latestStartMs: Date.parse('2026-11-16T05:12:41Z'),
    },
  });
  assert.equal(entry.id, '223');
  assert.equal(entry.title, 'W2MMD GCARC Clubhouse');
  assert.equal(entry.subtitle, '12 heard · 3 scheduled');
  assert.equal(entry.accent, Cesium.Color.CYAN.toCssColorString());
  assert.equal(entry.variant, 'label');
  assert.equal(entry.interactive, false);
  const quiet = createSatnogsOverlayEntry({
    id: '2575',
    position,
    station: {
      name: 'KC3QNJ',
      completedCount: 0,
      scheduledCount: 4,
      latestStartMs: null,
    },
  });
  assert.equal(quiet.subtitle, '0 heard · 4 scheduled');
  assert.equal(quiet.accent, Cesium.Color.GRAY.toCssColorString());
  // Completed count outranks recency: the busier station sorts first
  // even when the quiet one has a later scheduled pass.
  assert.ok(entry.priority > quiet.priority);
});

test('selectSatnogsOverlayCohort keeps the busiest, then newest', () => {
  const mk = (id, priority) => ({ id, priority });
  const entries = [
    mk('quiet-old', 1),
    mk('busy-new', 12_000_003_002),
    mk('busy-old', 12_000_000_001),
    mk('mid', 3_000_000_001),
  ];
  assert.deepEqual(
    selectSatnogsOverlayCohort(entries).map((e) => e.id),
    ['busy-new', 'busy-old', 'mid', 'quiet-old'],
  );
  assert.deepEqual(
    selectSatnogsOverlayCohort(entries, 2).map((e) => e.id),
    ['busy-new', 'busy-old'],
  );
  assert.deepEqual(selectSatnogsOverlayCohort(entries, 0), []);
  assert.deepEqual(selectSatnogsOverlayCohort(null), []);
  // The cohort never exceeds the limit, however many entries arrive.
  const many = Array.from({ length: 200 }, (_, i) => mk(`e-${i}`, i));
  assert.equal(selectSatnogsOverlayCohort(many).length, 8);
});

test('mapAnalystRecord is pure and null-safe', () => {
  assert.deepEqual(mapAnalystRecord({}, 3), {
    id: 'satnogs-0003',
    satelliteName: null,
    noradCatId: null,
    stationId: null,
    stationName: null,
    status: null,
    vettedStatus: null,
    lat: null,
    lon: null,
    hasPosition: false,
    hasWaterfall: false,
    hasAudio: false,
    demodCount: null,
    transmitterMode: null,
    downlinkHz: null,
    startMs: null,
    endMs: null,
  });
  const record = mapAnalystRecord({
    stableId: 'satnogs:15449441',
    satelliteName: 'CPSAT',
    noradCatId: 98194,
    stationId: 223,
    stationName: 'W2MMD GCARC Clubhouse',
    status: 'good',
    vettedStatus: null,
    lat: 39.716,
    lon: -75.21,
    hasPosition: true,
    waterfallUrl: 'https://example.com/w.png',
    audioUrl: 'https://example.com/a.ogg',
    demodCount: 21,
    transmitterMode: 'BPSK',
    downlinkHz: 437265000,
    startMs: 1_793_100_000_000,
    endMs: 1_793_100_600_000,
  });
  assert.equal(record.id, 'satnogs:15449441');
  assert.equal(record.satelliteName, 'CPSAT');
  assert.equal(record.hasPosition, true);
  assert.equal(record.hasWaterfall, true);
  assert.equal(record.hasAudio, true);
  assert.equal(record.startMs, 1_793_100_000_000);
});
