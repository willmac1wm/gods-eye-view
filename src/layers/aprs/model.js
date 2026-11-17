import * as Cesium from 'cesium';

export const APRS_OVERLAY_SOURCE_ID = 'aprs-weather';
/** All six registry stations fit; no thinning needed. */
export const APRS_OVERLAY_COHORT_LIMIT = 8;

export const APRS_MARKER_COLORS = Object.freeze({
  fresh: Cesium.Color.SKYBLUE,
  stale: Cesium.Color.GRAY,
  missing: Cesium.Color.DARKGRAY,
});

export function aprsMarkerColor(row) {
  if (row?.missing) return APRS_MARKER_COLORS.missing;
  if (row?.stale) return APRS_MARKER_COLORS.stale;
  return APRS_MARKER_COLORS.fresh;
}

function tempLabel(row) {
  return Number.isFinite(row?.tempF) ? `${Math.round(row.tempF)}°F` : '—';
}

/**
 * One overlay label per station: "KC2DUX 37°F". Stale stations are dimmed
 * with a clock badge; missing stations show no temperature. The station is
 * never removed from the map — a dead station is itself information.
 */
export function createAprsOverlayEntry({ id, position, row }) {
  const color = aprsMarkerColor(row);
  const title = `${row?.callsign ?? id} ${tempLabel(row)}`;
  const subtitle = row?.missing
    ? 'not reporting'
    : row?.stale
      ? `STALE — last report ${Number.isFinite(row?.ageMin) ? `${row.ageMin} min ago` : 'unknown'}`
      : null;
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    subtitle,
    accent: color.toCssColorString(),
    priority: row?.missing ? 0 : row?.stale ? 100 : 1000,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Keep every station: the cohort is the whole registry, fresh first. */
export function selectAprsOverlayCohort(
  entries,
  limit = APRS_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(APRS_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

/**
 * Analyst seam (mirror of mapAnalystRecord). Pure — no Cesium types.
 * `stale` stays on the record so queries can count only current
 * conditions; stale rows are not dropped here.
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.callsign) || `APRS-${String(index).padStart(4, '0')}`,
    place: text(raw?.place),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    timeMs: num(raw?.timeMs),
    tempF: num(raw?.tempF),
    humidity: num(raw?.humidity),
    pressureInHg: num(raw?.pressureInHg),
    windDirDeg: num(raw?.windDirDeg),
    windSpeedMph: num(raw?.windSpeedMph),
    windGustMph: num(raw?.windGustMph),
    rain24hMm: num(raw?.rain24hMm),
    stale: raw?.stale === true,
    missing: raw?.missing === true,
  };
}

export { normalizeAprsWxSnapshot } from './records.js';
export { APRS_STATIONS, aprsStationNames } from './stations.js';
