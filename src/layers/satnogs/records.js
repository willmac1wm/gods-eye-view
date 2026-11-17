import { SATNOGS_STATIONS, satnogsStationById } from './stations.js';

/**
 * SatNOGS satellite observations — normalization + locality filtering
 * for the SatNOGS layer.
 *
 * Source: the SatNOGS Network observations API
 * (https://network.satnogs.org/api/observations/), via the same-origin
 * `/api/satnogs` proxy — neither SatNOGS API sends CORS headers
 * (verified 2026-11-16). Free, keyless, CC BY-SA 4.0. The proxy
 * (`server/providers/satnogs.js`) fetches the raw observations, trims
 * them (no TLEs ever reach the client — this layer ingests no TLEs and
 * predicts no passes; the TLE-based satellites layer already does that),
 * and resolves satellite names through the SatNOGS DB
 * (https://db.satnogs.org/api/satellites/?norad_cat_id=…).
 *
 * Scope — "what the county's nearest SatNOGS ears heard": recent +
 * scheduled observations from the four Online ground stations within
 * 200 km of Cape May County (see stations.js). Trailing 7 days completed
 * (`status=good`) + next 48 h scheduled (`status=future`), with a
 * waterfall PNG and audio OGG link per completed observation. Markers sit
 * on the ground stations: observations carry station lat/lng and no
 * satellite position.
 *
 * DEFENSIVE RE-FILTERING: the upstream `?status=good` list has been seen
 * leaking `future` rows, so every row is re-checked here against its
 * status AND its timestamps — a row is completed only when its end is in
 * the past, scheduled only when its start is in the future and within
 * 48 h. Anything else (bad / failed / unvetted / out-of-window / off the
 * allowlist) is dropped.
 */

/** Trailing window for completed observations: 7 days. */
export const SATNOGS_TRAILING_MS = 7 * 24 * 60 * 60_000;
/** Forward window for scheduled observations: 48 hours. */
export const SATNOGS_SCHEDULED_MS = 48 * 60 * 60_000;

/** Public observation page, e.g. https://network.satnogs.org/observations/15449441/ */
export function satnogsObservationUrl(id) {
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) return null;
  return `https://network.satnogs.org/observations/${num}/`;
}

function text(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function httpsUrl(value) {
  const out = text(value);
  if (!out) return null;
  let parsed;
  try {
    parsed = new URL(out);
  } catch {
    return null;
  }
  return parsed.protocol === 'https:' ? out : null;
}

function ms(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function frequencyHz(observation) {
  for (const key of [
    'observation_frequency',
    'transmitter_downlink_low',
    'transmitter_downlink_high',
  ]) {
    const value = Number(observation?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Normalize one proxy observation into a display row, or null when it is
 * not a countable in-scope observation. Never throws.
 */
export function normalizeSatnogsObservation(
  observation,
  { now = Date.now() } = {},
) {
  if (!observation || typeof observation !== 'object') return null;
  const id = Number(observation.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const station = satnogsStationById(observation.ground_station);
  if (!station) return null; // locality filter: allowlisted stations only
  const status = text(observation.status);
  const startMs = ms(observation.start);
  const endMs = ms(observation.end);
  if (startMs == null || endMs == null || endMs < startMs) return null;
  // Defensive re-filter: status AND timestamps must agree. Upstream
  // `status=good` has leaked future rows; a "good" row whose end is in
  // the future is not completed, and a "future" row already started is
  // not scheduled.
  if (status === 'good') {
    if (endMs > now) return null;
    if (startMs < now - SATNOGS_TRAILING_MS) return null;
  } else if (status === 'future') {
    if (startMs <= now) return null;
    if (startMs > now + SATNOGS_SCHEDULED_MS) return null;
  } else {
    return null;
  }
  const noradCatId = Number(observation.norad_cat_id);
  const lat = Number(observation.station_lat ?? station.lat);
  const lon = Number(observation.station_lng ?? station.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const demodCount = Number(observation.demod_count);
  return {
    stableId: `satnogs:${id}`,
    id,
    satelliteName:
      text(observation.satellite_name) ??
      (Number.isInteger(noradCatId) && noradCatId > 0
        ? `NORAD ${noradCatId}`
        : 'Unknown satellite'),
    noradCatId:
      Number.isInteger(noradCatId) && noradCatId > 0 ? noradCatId : null,
    stationId: station.id,
    stationName: text(observation.station_name) ?? station.name,
    lat,
    lon,
    startMs,
    endMs,
    status,
    vettedStatus: text(observation.vetted_status),
    waterfallUrl: httpsUrl(observation.waterfall),
    audioUrl: httpsUrl(observation.payload),
    observationUrl: satnogsObservationUrl(id),
    demodCount: Number.isFinite(demodCount) && demodCount >= 0 ? demodCount : 0,
    transmitterDescription: text(observation.transmitter_description),
    transmitterMode: text(observation.transmitter_mode),
    downlinkHz: frequencyHz(observation),
    maxAltitude: Number.isFinite(Number(observation.max_altitude))
      ? Number(observation.max_altitude)
      : null,
    riseAzimuth: Number.isFinite(Number(observation.rise_azimuth))
      ? Number(observation.rise_azimuth)
      : null,
    setAzimuth: Number.isFinite(Number(observation.set_azimuth))
      ? Number(observation.set_azimuth)
      : null,
  };
}

/**
 * Normalize a proxy payload into display rows.
 *
 * Proxy payload: `{ stations: [{ id, name, lat, lon, ... }],
 * observations: [<trimmed observation>] }` — see server/providers/satnogs.js.
 *
 * Returns `{ rows, stations, completedCount, scheduledCount,
 * totalObservations, stationCount }` or null when the payload is
 * malformed. `rows` are newest-start-first; `stations` are the
 * allowlisted stations (pins show even with zero observations — a quiet
 * ear is still an ear), each with its completed/scheduled counts.
 */
export function normalizeSatnogsSnapshot(payload, { now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const observations = payload.observations;
  if (!Array.isArray(observations)) return null;

  const byId = new Map();
  for (const observation of observations) {
    const row = normalizeSatnogsObservation(observation, { now });
    if (!row) continue;
    const previous = byId.get(row.id);
    if (!previous || row.startMs > previous.startMs) byId.set(row.id, row);
  }
  const rows = [...byId.values()].sort((a, b) => b.startMs - a.startMs);

  const stations = SATNOGS_STATIONS.map((station) => {
    const stationRows = rows.filter((row) => row.stationId === station.id);
    const completed = stationRows.filter((row) => row.status === 'good');
    const scheduled = stationRows.filter((row) => row.status === 'future');
    return {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
      distanceKm: station.distanceKm,
      observations: station.observations,
      successRate: station.successRate,
      completedCount: completed.length,
      scheduledCount: scheduled.length,
      latestStartMs:
        stationRows.length > 0
          ? Math.max(...stationRows.map((row) => row.startMs))
          : null,
    };
  });

  return {
    rows,
    stations,
    completedCount: rows.filter((row) => row.status === 'good').length,
    scheduledCount: rows.filter((row) => row.status === 'future').length,
    totalObservations: rows.length,
    stationCount: stations.length,
  };
}

export { SATNOGS_STATIONS };
