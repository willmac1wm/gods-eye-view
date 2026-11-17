/**
 * SatNOGS ground-station allowlist — the single source of truth for which
 * stations the SatNOGS layer listens to. Stations are hard-coded here, not
 * discovered at runtime: the stations API returns all 4,578 stations
 * (3.5 MB, no server-side filter, no pagination), so a live discovery
 * pass on every refresh would burn the shared rate budget for nothing.
 *
 * Discovery: GET https://network.satnogs.org/api/stations/, filtered to
 * status Online within 200 km of the county anchor (39.0, -74.9),
 * re-discovered live 2026-11-16 ~01:30 EST (06:30 UTC). All four stations
 * below were Online with a last_seen within the same minute; their
 * lifetime observation counts and success rates are from that same fetch.
 * Re-discover before changing this list — stations go offline.
 *
 * EXCLUDED, with reasons (do not re-add without re-verifying):
 * - GS3 (id 941, 36 km, Offline, 0 lifetime obs): the nearest station
 *   overall, but Offline with no observations ever — excluded.
 * - K2ZA (1066, 68 km), KD2LBU (1265, 77 km), WILLIAMSTOWN STATION
 *   (1084, 78 km), jeffrey griffin (3260, 79 km), Rowan University
 *   Ground Station (3128, 80 km), W2MMD Lindenblad (1130, 84 km),
 *   KG4JYA (3427, 92 km), WB2MNF QTH (221, 96 km), N2QG (814, 96 km)
 *   and every other station within 200 km: all Offline at discovery.
 *   The nearest Online station past the four below is 257 km out.
 * - Hillsborough NJ (5268, 171 km): status Testing, not Online.
 */

/** County anchor: Cape May County (39.0, -74.9). */
export const SATNOGS_ANCHOR = Object.freeze({ lat: 39.0, lon: -74.9 });

/** Allowlist radius around the anchor, in kilometres. */
export const SATNOGS_RADIUS_KM = 200;

/**
 * The four Online stations within 200 km of the anchor, nearest first.
 * `distanceKm` is the haversine distance from the anchor (recomputed in
 * stations.test.mjs). `observations` is the station's lifetime count,
 * `successRate` its lifetime good-observation percentage, `lastSeen` the
 * station's last contact at discovery, `futureObservations` its scheduled
 * observations at discovery.
 */
export const SATNOGS_STATIONS = Object.freeze([
  Object.freeze({
    id: 223,
    name: 'W2MMD GCARC Clubhouse',
    lat: 39.716,
    lon: -75.21,
    distanceKm: 84,
    observations: 64276,
    successRate: 67,
    lastSeen: '2026-11-16T06:15:28Z',
    futureObservations: 29,
  }),
  Object.freeze({
    id: 2575,
    name: 'KC3QNJ',
    lat: 38.308,
    lon: -76.474,
    distanceKm: 157,
    observations: 2521,
    successRate: 68,
    lastSeen: '2026-11-16T06:15:05Z',
    futureObservations: 4,
  }),
  Object.freeze({
    id: 4655,
    name: 'Alx2',
    lat: 38.78407,
    lon: -77.11324,
    distanceKm: 193,
    observations: 13689,
    successRate: 65,
    lastSeen: '2026-11-16T06:15:01Z',
    futureObservations: 0,
  }),
  Object.freeze({
    id: 3610,
    name: 'ka6akh-ground-station',
    lat: 38.8246,
    lon: -77.14037,
    distanceKm: 195,
    observations: 7101,
    successRate: 79,
    lastSeen: '2026-11-16T06:15:28Z',
    futureObservations: 6,
  }),
]);

/** Station ids, nearest first, as the observations-API `ground_station` values. */
export function satnogsStationIds(stations = SATNOGS_STATIONS) {
  if (!Array.isArray(stations) || stations.length === 0)
    throw new Error('SatNOGS station registry is empty');
  const ids = stations.map((station) => {
    const id = Number(station?.id);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error('SatNOGS station registry has a bad id');
    return id;
  });
  if (new Set(ids).size !== ids.length)
    throw new Error('SatNOGS station registry has a duplicate id');
  return ids;
}

/** The allowlisted station with this id, or null. */
export function satnogsStationById(id, stations = SATNOGS_STATIONS) {
  const wanted = Number(id);
  if (!Number.isInteger(wanted)) return null;
  return stations.find((station) => station.id === wanted) ?? null;
}
