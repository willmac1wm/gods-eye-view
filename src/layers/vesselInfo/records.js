// src/layers/vesselInfo/records.js
// Pure record rules for vessel background: the AIS-field mapping and
// the reference link builders. No network, no Cesium, no clock, no
// i18n — the card formats these fields with t(), the analyst seam
// carries the URLs as data. Nothing is fetched from either reference:
// the human clicks through. Inspection / casualty / company records
// live on the linked sites, never in this app.
import { EQUASIS_HOME_URL, MARITIME_DATABASE_HOME_URL } from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * An IMO number is exactly 7 digits. Display-only use: a bad check
 * digit still displays (the checksum validation lives in
 * sanctionsWatch/records.js for the screening path, where a bad IMO
 * must be rejected before calling).
 */
function normalizeImo(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\s-]/g, '');
  return /^\d{7}$/.test(text) ? text : null;
}
export function buildEquasisLink(record) {
  return EQUASIS_HOME_URL;
}

/**
 * The Maritime Database link is the home page: the vessel page URL
 * carries an internal vesselid that cannot be derived from IMO/MMSI,
 * and no search URL is verified (its /search?query= path renders the
 * home page). Never guess a deep link.
 */
export function buildMaritimeDatabaseLink(record) {
  return MARITIME_DATABASE_HOME_URL;
}

export function buildBackgroundLinks(record) {
  return {
    equasis: buildEquasisLink(record),
    maritimeDatabase: buildMaritimeDatabaseLink(record),
  };
}

/**
 * Normalize one AIS analyst record to a vessel-background row. Fields
 * come from AIS alone; inspection / casualty / company records live
 * on the linked sites. Many Class-B and fishing vessels broadcast no
 * IMO — hasImo false means "search by name", never "unknown vessel".
 */
export function normalizeVesselBackground(record) {
  if (!record || typeof record !== 'object') return null;
  const mmsi = textValue(record.mmsi);
  if (!mmsi) return null;
  const rawImo = normalizeImo(record.imo);
  const imo = rawImo;
  return {
    mmsi,
    imo,
    hasImo: imo !== null,
    name: textValue(record.name),
    callsign: textValue(record.callsign),
    shipType: textValue(record.shipType ?? record.type),
    destination: textValue(record.destination),
    lat: numValue(record.lat),
    lon: numValue(record.lon),
    speedKts: numValue(record.speedKts ?? record.speed),
    courseDeg: numValue(record.courseDeg ?? record.course),
    lastSeenMs: numValue(record.lastSeenMs ?? record.lastPositionEpoch),
    links: buildBackgroundLinks(record),
  };
}
