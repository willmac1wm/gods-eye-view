// src/layers/plume/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConePolygon,
  buildPlumeSnapshot,
  degreesToCompass,
  destinationPoint,
  downwindBearing,
  epzCircleRing,
  haversineMi,
  parseNwsHourlyForecast,
  parseNwsHourlyPeriod,
  parseWindDirection,
  parseWindSpeed,
  stepPlume,
  validatePlumeSnapshot,
} from './records.js';

// Release point: the NRC Salem/Hope Creek site coordinates.
const RELEASE = { name: 'Salem/Hope Creek', lat: 39.46278, lon: -75.53556 };
const NW_5 = (time) => ({
  time,
  timeIso: null,
  speedMph: 5,
  directionFrom: 315,
});

// Hand-computed (independent spherical calculation, 2026-11-17): a steady
// 5 mph NW wind steps the centroid 5.0 mi per hour downwind (SE, 135°):
// node 1 (39.41159, -75.46933), node 2 (39.36040, -75.40315),
// node 3 (39.30921, -75.33701). Cone half-width at 15 mi = 4.019 mi.
const NODE_1 = { lat: 39.41159, lon: -75.46933 };
const NODE_2 = { lat: 39.3604, lon: -75.40315 };
const NODE_3 = { lat: 39.30921, lon: -75.33701 };

/** Initial bearing between two {lat, lon} points, in degrees. */
function bearingBetween(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

test('wind direction is FROM: NW blows toward SE', () => {
  assert.equal(parseWindDirection('NW'), 315);
  assert.equal(parseWindDirection('315'), 315);
  assert.equal(parseWindDirection(315), 315);
  assert.equal(parseWindDirection('N'), 0);
  assert.equal(parseWindDirection('xx'), null);
  assert.equal(parseWindDirection(null), null);
  assert.equal(downwindBearing(315), 135);
  assert.equal(downwindBearing(0), 180);
  assert.equal(downwindBearing(90), 270);
  assert.equal(downwindBearing(180), 0);
  assert.equal(downwindBearing(270), 90);
  assert.equal(downwindBearing(45), 225);
  assert.equal(downwindBearing(null), null);
  assert.equal(degreesToCompass(135), 'SE');
  assert.equal(degreesToCompass(0), 'N');
  assert.equal(degreesToCompass(359), 'N');
  assert.equal(degreesToCompass(100), 'E');
  assert.equal(degreesToCompass(null), null);
});

test('wind speed parses plain, ranged, and calm values', () => {
  assert.equal(parseWindSpeed('5 mph'), 5);
  assert.equal(parseWindSpeed('5 to 10 mph'), 7.5);
  assert.equal(parseWindSpeed('calm'), 0);
  assert.equal(parseWindSpeed('0 mph'), 0);
  assert.equal(parseWindSpeed(7), 7);
  assert.equal(parseWindSpeed(''), null);
  assert.equal(parseWindSpeed('no wind here'), null);
});

test('a live-shaped NWS period parses to a wind row', () => {
  const row = parseNwsHourlyPeriod({
    startTime: '2026-11-17T07:00:00-05:00',
    windSpeed: '5 mph',
    windDirection: 'NW',
  });
  assert.equal(row.time, '2026-11-17T07:00:00-05:00');
  assert.equal(row.speedMph, 5);
  assert.equal(row.directionFrom, 315);
  assert.equal(parseNwsHourlyPeriod({ startTime: 'x' }), null);
  assert.equal(parseNwsHourlyPeriod(null), null);
  assert.equal(parseNwsHourlyForecast({ properties: { periods: [] } }).length, 0);
  assert.equal(parseNwsHourlyForecast({}), null);
});

test('a steady NW wind steps 5.0 mi per hour toward SE', () => {
  const winds = [
    NW_5('2026-11-17T07:00:00-05:00'),
    NW_5('2026-11-17T08:00:00-05:00'),
    NW_5('2026-11-17T09:00:00-05:00'),
  ];
  const stepped = stepPlume({ release: RELEASE, winds, horizonHours: 3 });
  assert.equal(stepped.path.length, 4);
  assert.equal(stepped.distanceMi, 15);
  assert.equal(stepped.calmHours, 0);
  assert.equal(stepped.stoppedEarly, false);
  assert.equal(stepped.windsUsed, 3);
  for (const [index, node] of [NODE_1, NODE_2, NODE_3].entries()) {
    const got = stepped.path[index + 1];
    assert.ok(Math.abs(got.lat - node.lat) < 0.001, `node ${index + 1} lat`);
    assert.ok(Math.abs(got.lon - node.lon) < 0.001, `node ${index + 1} lon`);
    assert.equal(got.bearing, 135);
    assert.equal(got.calm, false);
  }
  for (let i = 1; i <= 3; i += 1) {
    const step = haversineMi(stepped.path[i - 1], stepped.path[i]);
    assert.ok(step > 4.99 && step < 5.01, `step ${i} is 5.0 mi, got ${step}`);
  }
  assert.ok(
    bearingBetween(stepped.path[0], stepped.path[3]) > 130 &&
      bearingBetween(stepped.path[0], stepped.path[3]) < 140,
  );
});

test('the cone widens at 15°: 4.019 mi half-width at 15 mi', () => {
  const winds = [NW_5('t1'), NW_5('t2'), NW_5('t3')];
  const stepped = stepPlume({ release: RELEASE, winds, horizonHours: 3 });
  const ring = buildConePolygon(stepped.path);
  // Apex + 3 left-edge nodes + 3 right-edge nodes.
  assert.equal(ring.length, 7);
  assert.deepEqual(ring[0], [RELEASE.lon, RELEASE.lat]);
  const farLeft = { lon: ring[3][0], lat: ring[3][1] };
  const farRight = { lon: ring[4][0], lat: ring[4][1] };
  const farWidth = haversineMi(farLeft, farRight);
  assert.ok(farWidth > 7.99 && farWidth < 8.09, `far width 8.04 mi, got ${farWidth}`);
  const halfWidth = haversineMi(stepped.path[3], farLeft);
  assert.ok(halfWidth > 3.99 && halfWidth < 4.05, `half-width 4.019 mi, got ${halfWidth}`);
  assert.equal(buildConePolygon([]), null);
});

test('a wind shift bends the path: NW then due-east downwind', () => {
  const winds = [
    NW_5('t1'),
    NW_5('t2'),
    { time: 't3', timeIso: null, speedMph: 5, directionFrom: 270 },
  ];
  const stepped = stepPlume({ release: RELEASE, winds, horizonHours: 3 });
  assert.equal(stepped.path.length, 4);
  const leg2 = bearingBetween(stepped.path[1], stepped.path[2]);
  const leg3 = bearingBetween(stepped.path[2], stepped.path[3]);
  assert.ok(leg2 > 130 && leg2 < 140, `leg 2 stays SE, got ${leg2}`);
  assert.ok(leg3 > 85 && leg3 < 95, `leg 3 turns due east, got ${leg3}`);
  assert.ok(
    Math.abs(stepped.path[3].lat - stepped.path[2].lat) < 0.001,
    'the east leg holds latitude',
  );
  assert.ok(stepped.path[3].lon > stepped.path[2].lon, 'the east leg gains longitude');
});

test('a calm hour pools in place: same position, wider cone, no crash', () => {
  const winds = [
    NW_5('t1'),
    { time: 't2', timeIso: null, speedMph: 0, directionFrom: 315 },
    NW_5('t3'),
  ];
  const stepped = stepPlume({ release: RELEASE, winds, horizonHours: 3 });
  assert.equal(stepped.path.length, 4);
  assert.equal(stepped.calmHours, 1);
  assert.equal(stepped.stoppedEarly, false);
  assert.equal(stepped.path[2].calm, true);
  assert.equal(stepped.path[2].lat, stepped.path[1].lat);
  assert.equal(stepped.path[2].lon, stepped.path[1].lon);
  assert.equal(stepped.path[2].poolMi, 1);
  assert.equal(stepped.path[3].poolMi, 1);
  assert.equal(stepped.distanceMi, 10);
  const ring = buildConePolygon(stepped.path);
  const farLeft = { lon: ring[3][0], lat: ring[3][1] };
  const halfWidth = haversineMi(stepped.path[3], farLeft);
  // 10 mi × tan(15°) + 1 mi pooling = 3.68 mi.
  assert.ok(halfWidth > 3.63 && halfWidth < 3.73, `pooled half-width 3.68 mi, got ${halfWidth}`);
});

test('a missing wind ends the path early, never guessed forward', () => {
  const winds = [NW_5('t1'), { time: 't2', timeIso: null, speedMph: null, directionFrom: 315 }];
  const stepped = stepPlume({ release: RELEASE, winds, horizonHours: 3 });
  assert.equal(stepped.stoppedEarly, true);
  assert.equal(stepped.windsUsed, 1);
  assert.equal(stepped.path.length, 2);
  assert.equal(stepped.distanceMi, 5);
});

test('the EPZ circle is 10 miles in every direction, closed', () => {
  const ring = epzCircleRing({ lat: RELEASE.lat, lon: RELEASE.lon });
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], ring[64]);
  for (const [lon, lat] of ring) {
    const d = haversineMi(RELEASE, { lat, lon });
    assert.ok(d > 9.99 && d < 10.01, `EPZ radius 10 mi, got ${d}`);
  }
  // 10 mi due north of the site (independent check).
  const north = destinationPoint(RELEASE, 0, 10);
  assert.ok(Math.abs(north.lat - 39.60751) < 0.001);
  assert.ok(Math.abs(north.lon - -75.53556) < 0.001);
  assert.equal(epzCircleRing({}), null);
});

test('the built snapshot carries winds, path, cone, and EPZ', () => {
  const winds = Array.from({ length: 24 }, (_, i) =>
    NW_5(`2026-11-17T${String(7 + i).padStart(2, '0')}:00:00-05:00`),
  );
  const snapshot = buildPlumeSnapshot({ fetchedAt: 1_793_123_456_789, winds });
  assert.equal(snapshot.release.name, 'Salem/Hope Creek');
  assert.equal(snapshot.release.lat, 39.46278);
  assert.equal(snapshot.release.lon, -75.53556);
  assert.equal(snapshot.horizonHours, 24);
  assert.equal(snapshot.counts.winds, 24);
  assert.equal(snapshot.counts.nodes, 25);
  assert.equal(snapshot.distanceMi, 120);
  assert.equal(snapshot.calmHours, 0);
  assert.equal(snapshot.stoppedEarly, false);
  assert.equal(snapshot.cone.length, 49);
  assert.equal(snapshot.epz.length, 65);
  assert.equal(validatePlumeSnapshot(snapshot), snapshot);
  assert.equal(buildPlumeSnapshot({ winds }), null);
  assert.equal(validatePlumeSnapshot({ nope: true }), null);
  assert.equal(validatePlumeSnapshot({ ...snapshot, fetchedAt: 'soon' }), null);
});
