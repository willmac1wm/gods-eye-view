import * as Cesium from 'cesium';

export const MARINE_WARNINGS_OVERLAY_SOURCE_ID = 'marine-warnings';
export const MARINE_WARNINGS_OVERLAY_COHORT_LIMIT = 96;
export const MARINE_WARNINGS_OVERLAY_COLLISION_CAPACITY = 48;

/**
 * Severity is OUR heuristic — the source carries no severity field (see
 * records.js). High is red, moderate orange/amber, low yellow; list-only
 * rows never reach the overlay, so there is no grey pin.
 */
export const MARINE_SEVERITY_COLORS = Object.freeze({
  high: Cesium.Color.RED,
  moderate: Cesium.Color.ORANGE,
  low: Cesium.Color.YELLOW,
  info: Cesium.Color.GRAY,
});

export function severityColor(severity) {
  return MARINE_SEVERITY_COLORS[severity] ?? MARINE_SEVERITY_COLORS.moderate;
}

const SEVERITY_RANK = Object.freeze({ high: 3, moderate: 2, low: 1, info: 0 });

/**
 * One overlay label per positioned warning: "BNM 0478-26 · HAZ OPS".
 * The subtitle is the geographic area. The label strings are built in
 * locals first (aprs model precedent): the overlay entry itself carries
 * data — number, descriptor code, area — not translated prose.
 * Priority is severity first, then recency (newer warnings surface).
 */
export function createMarineWarningsOverlayEntry({ id, position, row }) {
  const color = severityColor(row?.severity);
  const recency = Number.isFinite(row?.pubDateMs)
    ? Math.max(0, Math.floor(row.pubDateMs / 60_000))
    : 0;
  const title = `BNM ${row?.number ?? id}${row?.descriptor ? ` · ${row.descriptor}` : ''}`;
  const subtitle = row?.area ?? null;
  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    subtitle,
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

/** Keep the most severe, then newest, warnings, with stable identity as the tie-break. */
export function selectMarineWarningsOverlayCohort(
  entries,
  limit = MARINE_WARNINGS_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(
      MARINE_WARNINGS_OVERLAY_COHORT_LIMIT,
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
 * List-only rows have no entity, so they never reach this seam: the
 * analyst engine only sees positioned warnings until a list-first seam
 * is built. `hasPosition` is always true here by construction.
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.stableId) || `BNM-${String(index).padStart(4, '0')}`,
    originator: text(raw?.originator),
    number: text(raw?.number),
    criticality: text(raw?.criticality),
    area: text(raw?.area),
    descriptor: text(raw?.descriptor),
    severity: text(raw?.severity),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    hasPosition: raw?.hasPosition === true,
    polygon: raw?.polygon === true,
    llnr: text(raw?.llnr),
    timeMs: num(raw?.pubDateMs ?? raw?.timeMs),
    cancelAtMs: num(raw?.cancelAtMs),
  };
}

export { normalizeMarineWarningsSnapshot } from './records.js';
