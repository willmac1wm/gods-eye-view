import * as Cesium from 'cesium';
export const TIDES_OVERLAY_SOURCE_ID = 'tides';
export const TIDES_OVERLAY_COHORT_LIMIT = 2;

export const TIDE_STAGE_COLORS = Object.freeze({
  none: Cesium.Color.SKYBLUE,
  minor: Cesium.Color.YELLOW,
  moderate: Cesium.Color.ORANGE,
  major: Cesium.Color.RED,
});

export function stageColor(stage) {
  return TIDE_STAGE_COLORS[stage] ?? TIDE_STAGE_COLORS.none;
}

const STAGE_RANK = Object.freeze({ none: 0, minor: 1, moderate: 2, major: 3 });

/** One overlay label per gauge: "Cape May 2.5′ ▲" + stage accent. */
export function createTidesOverlayEntry({ id, position, row }) {
  const residual = Number.isFinite(row?.residualFt)
    ? ` ${row.residualFt >= 0 ? '+' : ''}${row.residualFt.toFixed(2)}′ surge`
    : '';
  const arrow =
    row?.trend === 'rising' ? ' ▲' : row?.trend === 'falling' ? ' ▼' : '';
  return {
    id: String(id),
    position,
    variant: 'label',
    title: `${row?.name ?? id} ${Number(row?.observedFtMllw ?? NaN).toFixed(1)}′${arrow}`,
    subtitle: residual.trim() || null,
    accent: stageColor(row?.floodStage).toCssColorString(),
    priority:
      (STAGE_RANK[row?.floodStage] ?? 0) * 1000 +
      Math.round(Math.abs(row?.residualFt ?? 0) * 100),
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

/** Analyst seam (mirror of mapAnalystRecord). Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  // The analyst engine's time filters need epoch ms; the gauge's verbatim
  // "YYYY-MM-DD HH:MM" station-local string parses as local time. Keep the
  // verbatim string too — it is what the panel shows.
  const timeMs = (() => {
    if (Number.isFinite(raw?.timeMs)) return raw.timeMs;
    const parsed = Date.parse(String(raw?.observedTime ?? raw?.time ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.stationId) || `TIDE-${String(index).padStart(4, '0')}`,
    station: text(raw?.name),
    observedFtMllw: num(raw?.observedFtMllw),
    predictedFtMllw: num(raw?.predictedFtMllw),
    residualFt: num(raw?.residualFt),
    floodStage: text(raw?.floodStage),
    trend: text(raw?.trend),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    time: text(raw?.observedTime ?? raw?.time),
    timeMs,
  };
}
