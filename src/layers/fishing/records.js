// src/layers/fishing/records.js
// Pure record rules for fishing-vessel presence: the ship-type-30
// filter, the county-box filter, and the GFW link builders. No network,
// no Cesium, no clock. Presence only — never "fishing effort".
import {
  FISHING_BOX,
  FISHING_SHIP_TYPE,
  GFW_APIS_URL,
  GFW_MAP_HOME_URL,
  gfwMapUrl,
} from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function shipTypeValue(record) {
  return String(record?.shipType ?? record?.type ?? '').trim();
}

/**
 * A fishing vessel: AIS ship type 30, or a type string that reads
 * fishing (the AIS layer sometimes carries labels). Types 31/32
 * (towing) never match /fishing/i and are excluded.
 */
export function isFishingVessel(record) {
  const type = shipTypeValue(record);
  if (!type) return false;
  return type === FISHING_SHIP_TYPE || /fishing/i.test(type);
}

/** True when the fix falls inside the county / Delaware Bay box. */
export function inFishingBox(record) {
  const lat = numValue(record?.lat);
  const lon = numValue(record?.lon);
  if (lat === null || lon === null) return false;
  return (
    lat >= FISHING_BOX.minLat &&
    lat <= FISHING_BOX.maxLat &&
    lon >= FISHING_BOX.minLon &&
    lon <= FISHING_BOX.maxLon
  );
}

/**
 * Normalize one AIS analyst record to a fishing-presence row, or null
 * when it is not a fishing vessel in the box with a usable position.
 */
export function normalizeFishingRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (!isFishingVessel(record)) return null;
  if (!inFishingBox(record)) return null;
  const mmsi = textValue(record.mmsi);
  const lat = numValue(record.lat);
  const lon = numValue(record.lon);
  if (!mmsi || lat === null || lon === null) return null;
  return {
    mmsi,
    imo: textValue(record.imo),
    name: textValue(record.name),
    lat,
    lon,
    speedKts: numValue(record.speedKts ?? record.speed),
    courseDeg: numValue(record.courseDeg ?? record.course),
    shipType: shipTypeValue(record) || null,
    destination: textValue(record.destination),
    lastPositionEpoch: numValue(record.lastPositionEpoch),
    lastSeenMs: numValue(record.lastPositionEpoch),
  };
}

export function buildFishingLinks() {
  return {
    gfwMap: gfwMapUrl(),
    gfwMapHome: GFW_MAP_HOME_URL,
    gfwApis: GFW_APIS_URL,
  };
}
