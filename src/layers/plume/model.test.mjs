// src/layers/plume/model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFalloutPlumeOverlayEntry,
  mapAnalystRecord,
} from './model.js';

// Live-shaped snapshot: 3 hours of 5 mph NW winds from Salem/Hope Creek.
const LIVE_SNAPSHOT = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  release: { name: 'Salem/Hope Creek', lat: 39.46278, lon: -75.53556, time: null },
  horizonHours: 24,
  winds: [
    { time: '2026-11-17T07:00:00-05:00', timeIso: '2026-11-17T12:00:00.000Z', speedMph: 5, directionFrom: 315 },
    { time: '2026-11-17T08:00:00-05:00', timeIso: '2026-11-17T13:00:00.000Z', speedMph: 5, directionFrom: 315 },
    { time: '2026-11-17T09:00:00-05:00', timeIso: '2026-11-17T14:00:00.000Z', speedMph: 5, directionFrom: 315 },
  ],
  path: [
    { lat: 39.46278, lon: -75.53556, time: null, hour: 0, distanceMi: 0, poolMi: 0, bearing: null, calm: false },
    { lat: 39.41159, lon: -75.46933, time: '2026-11-17T07:00:00-05:00', hour: 1, distanceMi: 5, poolMi: 0, bearing: 135, calm: false },
    { lat: 39.3604, lon: -75.40315, time: '2026-11-17T08:00:00-05:00', hour: 2, distanceMi: 10, poolMi: 0, bearing: 135, calm: false },
    { lat: 39.30921, lon: -75.33701, time: '2026-11-17T09:00:00-05:00', hour: 3, distanceMi: 15, poolMi: 0, bearing: 135, calm: false },
  ],
  cone: [[-75.53556, 39.46278]],
  epz: [[-75.53556, 39.60751]],
  distanceMi: 15,
  calmHours: 0,
  stoppedEarly: false,
  counts: { winds: 3, nodes: 4 },
};

test('the anchor label reports SE downwind, 15 mi, and both disclaimers', () => {
  const entry = createFalloutPlumeOverlayEntry({ snapshot: LIVE_SNAPSHOT });
  assert.equal(entry.id, 'fallout-plume');
  assert.match(entry.title, /☢️/);
  assert.match(entry.title, /SE/);
  assert.equal(entry.details.length, 3);
  assert.match(entry.details[0], /15 mi in 24 h/);
  assert.match(entry.details[1], /Advection only — not a HYSPLIT run/);
  assert.match(entry.details[2], /Planning aid only — follow official guidance/);
  // Plume orange accent (Cesium converts the hex to rgb — compare
  // against the conversion, not the hex).
  assert.equal(entry.accent, 'rgb(255,140,66)');
  assert.equal(entry.priority, 2);
  assert.equal(entry.variant, 'label');
});

test('no winds still labels the plume unavailable, never a bare title', () => {
  const entry = createFalloutPlumeOverlayEntry({ snapshot: null });
  assert.match(entry.title, /Fallout plume/);
  assert.doesNotMatch(entry.title, /SE/);
  assert.match(entry.details[0], /Plume unavailable — no wind data/);
  assert.match(entry.details[1], /not a HYSPLIT run/);
});

test('the analyst seam dispatches wind rows and path nodes', () => {
  const wind = mapAnalystRecord(
    { kind: 'wind', time: '2026-11-17T07:00:00-05:00', timeIso: '2026-11-17T12:00:00.000Z', speedMph: 5, directionFrom: 315 },
    0,
  );
  assert.equal(wind.kind, 'wind');
  assert.equal(wind.speedMph, 5);
  assert.equal(wind.directionFrom, 315);
  assert.equal(wind.downwindBearing, 135);
  assert.equal(wind.source, 'NWS api.weather.gov');
  const node = mapAnalystRecord(
    { kind: 'node', hour: 1, lat: 39.41159, lon: -75.46933, time: '2026-11-17T07:00:00-05:00', distanceMi: 5, calm: false },
    1,
  );
  assert.equal(node.kind, 'node');
  assert.equal(node.id, 'PLUME-NODE-01');
  assert.equal(node.lat, 39.41159);
  assert.equal(node.calm, false);
  assert.equal(node.source, 'NWS api.weather.gov');
});
