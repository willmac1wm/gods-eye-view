import { APRS_STATIONS } from './stations.js';

/**
 * Validate an aprs.fi weather snapshot before it can replace the displayed
 * stations. Whole-payload rejection (return null) mirrors
 * normalizeEarthquakeSnapshot: a malformed payload never partially
 * overwrites good data. A station absent from the payload (or with no
 * report time) is NOT malformed — it becomes a `missing` row, so the panel
 * can show "not reporting" instead of silently shrinking the list.
 *
 * Units: aprs.fi is ALWAYS metric (temp °C, wind m/s, pressure mbar, rain
 * mm, Unix-second timestamps). The proxy converts `time` seconds to
 * `timeMs`; this module adds the imperial display values (US audience).
 * Missing aprs.fi keys are `null`, never invented values.
 */

/** A station is stale after 60 min without a report (12 missed ~5-min reports). */
export const APRS_STALE_MINUTES = 60;
export const APRS_STALE_MS = APRS_STALE_MINUTES * 60_000;

const TEMP_C_MIN = -60;
const TEMP_C_MAX = 60;
const PRESSURE_MB_MIN = 800;
const PRESSURE_MB_MAX = 1100;

function finiteNumber(value) {
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(value) ? value : null;
}

function optionalFinite(value) {
  if (value == null || value === '') return null;
  return finiteNumber(value);
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function celsiusToFahrenheit(celsius) {
  return round(celsius * (9 / 5) + 32, 1);
}

export function metersPerSecondToMph(mps) {
  return round(mps * 2.23694, 1);
}

export function millibarToInchesHg(mb) {
  return round(mb * 0.02953, 2);
}

export function millimetersToInches(mm) {
  return round(mm / 25.4, 2);
}

function validStation(station, seen) {
  if (!station || typeof station !== 'object' || Array.isArray(station))
    return false;
  const callsign = String(station.callsign ?? '').trim().toUpperCase();
  if (!callsign || seen.has(callsign)) return false;
  seen.add(callsign);
  const lat = finiteNumber(station.lat);
  const lon = finiteNumber(station.lon);
  return (
    lat != null &&
    Math.abs(lat) <= 90 &&
    lon != null &&
    Math.abs(lon) <= 180
  );
}

/**
 * Proxy payload:
 * `{fetchedAt, stale, ttlMs, count, stations: [{callsign, place, lat, lon,
 * timeMs, tempC, humidity, pressureMb, windDirDeg, windSpeedMps,
 * windGustMps, rain1hMm, rain24hMm, rainMnMm, luminosity, missing}]}`
 * Returns one row per registry station (in registry order), or null when
 * the payload is structurally malformed.
 */
export function normalizeAprsWxSnapshot(
  payload,
  { stations = APRS_STATIONS, nowMs = Date.now() } = {},
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (!Array.isArray(payload.stations)) return null;
  if (
    !Array.isArray(stations) ||
    stations.length === 0 ||
    !Number.isFinite(nowMs)
  )
    return null;
  const seenRegistry = new Set();
  for (const station of stations) {
    if (!validStation(station, seenRegistry)) return null;
  }

  const byCallsign = new Map();
  for (const entry of payload.stations) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const callsign = String(entry.callsign ?? '').trim().toUpperCase();
    if (!callsign || byCallsign.has(callsign)) return null; // duplicate
    byCallsign.set(callsign, entry);
  }
  // An entry for a station outside the registry is a wiring bug, not data.
  for (const callsign of byCallsign.keys()) {
    if (!seenRegistry.has(callsign)) return null;
  }

  const rows = [];
  for (const station of stations) {
    const callsign = String(station.callsign).trim().toUpperCase();
    const entry = byCallsign.get(callsign);
    const base = {
      callsign,
      place: station.place ?? null,
      lat: station.lat,
      lon: station.lon,
    };
    if (!entry || entry.missing) {
      rows.push({
        ...base,
        timeMs: null,
        tempC: null,
        tempF: null,
        humidity: null,
        pressureMb: null,
        pressureInHg: null,
        windDirDeg: null,
        windSpeedMps: null,
        windSpeedMph: null,
        windGustMps: null,
        windGustMph: null,
        rain1hMm: null,
        rain24hMm: null,
        rainMnMm: null,
        rain1hIn: null,
        rain24hIn: null,
        rainMnIn: null,
        luminosity: null,
        ageMin: null,
        stale: true,
        missing: true,
      });
      continue;
    }

    // Payload coordinates, when present, must be sane — a present but
    // non-finite coordinate is malformed, not missing. The registry pin
    // is still the row's position (the registry is the source of truth).
    const lat = optionalFinite(entry.lat);
    const lon = optionalFinite(entry.lon);
    if (
      (entry.lat != null && entry.lat !== '' && lat == null) ||
      (entry.lon != null && entry.lon !== '' && lon == null) ||
      (lat != null && Math.abs(lat) > 90) ||
      (lon != null && Math.abs(lon) > 180)
    )
      return null;
    const timeMs = optionalFinite(entry.timeMs);
    if (timeMs != null && timeMs < 0) return null;
    const tempC = optionalFinite(entry.tempC);
    if (tempC != null && (tempC < TEMP_C_MIN || tempC > TEMP_C_MAX))
      return null;
    const pressureMb = optionalFinite(entry.pressureMb);
    if (
      pressureMb != null &&
      (pressureMb < PRESSURE_MB_MIN || pressureMb > PRESSURE_MB_MAX)
    )
      return null;
    const humidity = optionalFinite(entry.humidity);
    if (humidity != null && (humidity < 0 || humidity > 100)) return null;
    const windDirDeg = optionalFinite(entry.windDirDeg);
    if (windDirDeg != null && (windDirDeg < 0 || windDirDeg > 360))
      return null;
    const windSpeedMps = optionalFinite(entry.windSpeedMps);
    if (windSpeedMps != null && windSpeedMps < 0) return null;
    const windGustMps = optionalFinite(entry.windGustMps);
    if (windGustMps != null && windGustMps < 0) return null;
    const rain1hMm = optionalFinite(entry.rain1hMm);
    const rain24hMm = optionalFinite(entry.rain24hMm);
    const rainMnMm = optionalFinite(entry.rainMnMm);
    if (
      (rain1hMm != null && rain1hMm < 0) ||
      (rain24hMm != null && rain24hMm < 0) ||
      (rainMnMm != null && rainMnMm < 0)
    )
      return null;
    const luminosity = optionalFinite(entry.luminosity);
    if (luminosity != null && luminosity < 0) return null;

    // An entry with no report time is undated and unusable — treat it
    // exactly like an absent station ("not reporting").
    if (timeMs == null) {
      rows.push({
        ...base,
        timeMs: null,
        tempC: null,
        tempF: null,
        humidity: null,
        pressureMb: null,
        pressureInHg: null,
        windDirDeg: null,
        windSpeedMps: null,
        windSpeedMph: null,
        windGustMps: null,
        windGustMph: null,
        rain1hMm: null,
        rain24hMm: null,
        rainMnMm: null,
        rain1hIn: null,
        rain24hIn: null,
        rainMnIn: null,
        luminosity: null,
        ageMin: null,
        stale: true,
        missing: true,
      });
      continue;
    }

    const ageMs = nowMs - timeMs;
    rows.push({
      ...base,
      timeMs,
      tempC,
      tempF: tempC == null ? null : celsiusToFahrenheit(tempC),
      humidity,
      pressureMb,
      pressureInHg: pressureMb == null ? null : millibarToInchesHg(pressureMb),
      windDirDeg,
      windSpeedMps,
      windSpeedMph:
        windSpeedMps == null ? null : metersPerSecondToMph(windSpeedMps),
      windGustMps,
      windGustMph:
        windGustMps == null ? null : metersPerSecondToMph(windGustMps),
      rain1hMm,
      rain24hMm,
      rainMnMm,
      rain1hIn: rain1hMm == null ? null : millimetersToInches(rain1hMm),
      rain24hIn: rain24hMm == null ? null : millimetersToInches(rain24hMm),
      rainMnIn: rainMnMm == null ? null : millimetersToInches(rainMnMm),
      luminosity,
      ageMin: Math.max(0, Math.floor(ageMs / 60_000)),
      stale: ageMs > APRS_STALE_MS,
      missing: false,
    });
  }
  return rows;
}
