import * as Cesium from 'cesium';
import { VDL2_CATEGORY_LABEL } from './records.js';

export const VDL2_OVERLAY_SOURCE_ID = 'vdl2';
export const VDL2_OVERLAY_COHORT_LIMIT = 96;
export const VDL2_OVERLAY_COLLISION_CAPACITY = 48;

/**
 * Severity is the watcher's: critical is red, high orange, and the
 * undecoded-frame pseudo-category is info grey. Only positioned rows
 * reach the overlay; list-only rows never get a pin.
 */
export const VDL2_SEVERITY_COLORS = Object.freeze({
  critical: Cesium.Color.RED,
  high: Cesium.Color.ORANGE,
  info: Cesium.Color.GRAY,
});

export function vdl2SeverityColor(severity) {
  return VDL2_SEVERITY_COLORS[severity] ?? VDL2_SEVERITY_COLORS.info;
}

const SEVERITY_RANK = Object.freeze({ critical: 3, high: 2, info: 1 });

export function vdl2CategoryLabel(category) {
  return VDL2_CATEGORY_LABEL[category] ?? category ?? 'Message';
}

/**
 * One overlay label per positioned row: "UAL123 · Mayday call". The
 * subtitle is the tail and the hearing station. The label strings are
 * built from data — flight, category label, tail, station — not
 * translated prose (marine-warnings precedent).
 * Priority is severity first, then recency (newer messages surface).
 */
export function createVdl2OverlayEntry({ id, position, row }) {
  const color = vdl2SeverityColor(row?.severity);
  const recency = Number.isFinite(row?.timeMs)
    ? Math.max(0, Math.floor(row.timeMs / 60_000))
    : 0;
  const who = row?.flight ?? row?.tail ?? String(id);
  const title = `${who} · ${vdl2CategoryLabel(row?.category)}`;
  const subtitle = [
    row?.tail && row.tail !== who ? row.tail : null,
    row?.stationIdent ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    subtitle: subtitle === '' ? null : subtitle,
    accent: color.toCssColorString(),
    priority: (SEVERITY_RANK[row?.severity] ?? 0) * 1_000_000_000 + recency,
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

/** Keep the most severe, then newest, messages, with stable identity as the tie-break. */
export function selectVdl2OverlayCohort(
  entries,
  limit = VDL2_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(VDL2_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
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
 * One record per row: categorized messages and local undecoded frames
 * alike. `hasPosition` is true only when the flight fix fell inside
 * the local box (see records.js) — a stale remote fix is not a
 * position. No raw text ever reaches this seam (rows never carry it).
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.stableId) || `vdl2-${String(index).padStart(4, '0')}`,
    flight: text(raw?.flight),
    tail: text(raw?.tail),
    fromHex: text(raw?.fromHex),
    label: text(raw?.label),
    mode: text(raw?.mode),
    frequency: num(raw?.frequency),
    stationIdent: text(raw?.stationIdent),
    stationAirport: text(raw?.stationAirport),
    category: text(raw?.category),
    severity: text(raw?.severity),
    undecoded: raw?.undecoded === true,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    hasPosition: raw?.hasPosition === true,
    timeMs: num(raw?.timeMs),
    url: text(raw?.url),
  };
}

export { normalizeVdl2Snapshot } from './records.js';
