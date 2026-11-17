import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SATNOGS_ANCHOR,
  SATNOGS_RADIUS_KM,
  SATNOGS_STATIONS,
  satnogsStationIds,
  satnogsStationById,
} from './stations.js';

/** Haversine distance in kilometres. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

test('the allowlist is the four Online stations within 200 km', () => {
  assert.equal(SATNOGS_ANCHOR.lat, 39.0);
  assert.equal(SATNOGS_ANCHOR.lon, -74.9);
  assert.equal(SATNOGS_RADIUS_KM, 200);
  assert.deepEqual(
    SATNOGS_STATIONS.map((station) => station.id),
    [223, 2575, 4655, 3610],
  );
  assert.deepEqual(
    SATNOGS_STATIONS.map((station) => station.name),
    [
      'W2MMD GCARC Clubhouse',
      'KC3QNJ',
      'Alx2',
      'ka6akh-ground-station',
    ],
  );
});

test('recorded distances match the anchor within 2 km', () => {
  for (const station of SATNOGS_STATIONS) {
    const computed = haversineKm(
      SATNOGS_ANCHOR.lat,
      SATNOGS_ANCHOR.lon,
      station.lat,
      station.lon,
    );
    assert.ok(
      Math.abs(computed - station.distanceKm) <= 2,
      `${station.name}: recorded ${station.distanceKm} km, computed ${computed.toFixed(1)} km`,
    );
    assert.ok(computed <= SATNOGS_RADIUS_KM, station.name);
  }
  // Nearest first.
  const distances = SATNOGS_STATIONS.map((station) => station.distanceKm);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
});

test('station metadata is finite and sane', () => {
  for (const station of SATNOGS_STATIONS) {
    assert.ok(Number.isFinite(station.lat));
    assert.ok(Number.isFinite(station.lon));
    assert.ok(Number.isInteger(station.observations));
    assert.ok(station.observations > 0);
    assert.ok(station.successRate >= 0 && station.successRate <= 100);
    assert.ok(!Number.isNaN(Date.parse(station.lastSeen)));
    assert.ok(Number.isInteger(station.futureObservations));
    assert.ok(station.futureObservations >= 0);
  }
  // The anchor station alone carries the bulk of the history.
  assert.equal(SATNOGS_STATIONS[0].observations, 64276);
});

test('satnogsStationIds rejects empty, duplicate, and bad registries', () => {
  assert.deepEqual(satnogsStationIds(), [223, 2575, 4655, 3610]);
  assert.throws(() => satnogsStationIds([]), /empty/);
  assert.throws(
    () =>
      satnogsStationIds([
        { id: 223 },
        { id: 223 },
      ]),
    /duplicate/,
  );
  assert.throws(
    () => satnogsStationIds([{ id: 'bogus' }]),
    /bad id/,
  );
});

test('satnogsStationById finds stations and returns null otherwise', () => {
  assert.equal(satnogsStationById(223).name, 'W2MMD GCARC Clubhouse');
  assert.equal(satnogsStationById('3610').name, 'ka6akh-ground-station');
  assert.equal(satnogsStationById(941), null);
  assert.equal(satnogsStationById('bogus'), null);
  assert.equal(satnogsStationById(null), null);
});
