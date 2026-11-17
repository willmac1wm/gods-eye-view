// src/layers/vesselInfo/model.js
import { VESSEL_INFO_ATTRIBUTION } from './policy.js';

export const VESSEL_INFO_ATTRIBUTION_TEXT = VESSEL_INFO_ATTRIBUTION;

/**
 * Analyst seam. Pure — no Cesium types. One row per vessel in the
 * feed with its background references: the URLs are data here (the
 * overlay card is text-only, so the links live in the analyst seam
 * and the layer panel, not on the map).
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const links = raw?.links ?? {};
  return {
    id: text(raw?.mmsi) || `VESSEL-INFO-${String(index).padStart(4, '0')}`,
    mmsi: text(raw?.mmsi),
    imo: text(raw?.imo),
    hasImo: raw?.hasImo === true,
    name: text(raw?.name),
    callsign: text(raw?.callsign),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    speedKts: num(raw?.speedKts),
    courseDeg: num(raw?.courseDeg),
    shipType: text(raw?.shipType),
    destination: text(raw?.destination),
    equasisUrl: text(links.equasis),
    maritimeDatabaseUrl: text(links.maritimeDatabase),
    lastSeenMs: num(raw?.lastSeenMs),
  };
}
