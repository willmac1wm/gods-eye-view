import * as Cesium from 'cesium';

export const SATNOGS_OVERLAY_SOURCE_ID = 'satnogs';
export const SATNOGS_OVERLAY_COHORT_LIMIT = 8;
export const SATNOGS_OVERLAY_COLLISION_CAPACITY = 4;

/**
 * One pin per ground station (not per observation — the anchor station
 * alone hears ~25 good passes in two days, and they would all stack on
 * the same point). A station that heard something recently is cyan; a
 * station with no recent good observation is grey. List-only has no
 * meaning here: every station gets a pin, even with zero observations.
 */
export const SATNOGS_STATION_COLORS = Object.freeze({
  active: Cesium.Color.CYAN,
  quiet: Cesium.Color.GRAY,
});

export function satnogsStationColor(station) {
  return (station?.completedCount ?? 0) > 0
    ? SATNOGS_STATION_COLORS.active
    : SATNOGS_STATION_COLORS.quiet;
}

/**
 * One overlay label per station: "W2MMD GCARC Clubhouse" with the
 * subtitle "12 heard · 3 scheduled". Priority is completed count first,
 * then scheduled, then recency (a station heard from most recently
 * surfaces).
 */
export function createSatnogsOverlayEntry({ id, position, station }) {
  const color = satnogsStationColor(station);
  const recency = Number.isFinite(station?.latestStartMs)
    ? Math.max(0, Math.floor(station.latestStartMs / 60_000))
    : 0;
  const title = station?.name ?? String(id);
  const completed = station?.completedCount ?? 0;
  const scheduled = station?.scheduledCount ?? 0;
  const subtitle = `${completed} heard · ${scheduled} scheduled`;
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    subtitle,
    accent: color.toCssColorString(),
    priority:
      completed * 1_000_000_000 + scheduled * 1_000_000 + recency,
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

/** Keep the busiest, then most recently heard-from, stations. */
export function selectSatnogsOverlayCohort(
  entries,
  limit = SATNOGS_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(
      SATNOGS_OVERLAY_COHORT_LIMIT,
      Math.floor(Number(limit) || 0),
    ),
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
 * One record per observation, positioned at its ground station (the
 * observation carries station lat/lng and no satellite position).
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.stableId) || `satnogs-${String(index).padStart(4, '0')}`,
    satelliteName: text(raw?.satelliteName),
    noradCatId: num(raw?.noradCatId),
    stationId: num(raw?.stationId),
    stationName: text(raw?.stationName),
    status: text(raw?.status),
    vettedStatus: text(raw?.vettedStatus),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    hasPosition: raw?.hasPosition === true,
    hasWaterfall: raw?.waterfallUrl != null,
    hasAudio: raw?.audioUrl != null,
    demodCount: num(raw?.demodCount),
    transmitterMode: text(raw?.transmitterMode),
    downlinkHz: num(raw?.downlinkHz),
    startMs: num(raw?.startMs),
    endMs: num(raw?.endMs),
  };
}

export { normalizeSatnogsSnapshot } from './records.js';
