import * as Cesium from 'cesium';
export const GAUGES_OVERLAY_SOURCE_ID = 'water-gauges';
export const GAUGES_OVERLAY_COHORT_LIMIT = 2;
export const GAUGES_ATTRIBUTION = 'Source: USGS, provisional data';

export const GAUGE_STATE_COLORS = Object.freeze({
  current: Cesium.Color.SKYBLUE,
  stale: Cesium.Color.ORANGE,
});

export function gaugeStateColor(stale) {
  return stale ? GAUGE_STATE_COLORS.stale : GAUGE_STATE_COLORS.current;
}

function formatHeight(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}′` : '—';
}

function formatFlow(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ft³/s` : null;
}

/** One overlay label per gauge: "Tuckahoe R. — Head of River 3.94′". */
export function createGaugesOverlayEntry({ id, gauge }) {
  const flow = formatFlow(gauge?.discharge?.value);
  const provisional =
    gauge?.gageHeight?.approvalStatus === 'Provisional' ||
    gauge?.discharge?.approvalStatus === 'Provisional';
  return {
    id: String(id),
    position: Cesium.Cartesian3.fromDegrees(gauge.lon, gauge.lat),
    variant: 'label',
    title: `${gauge?.shortName ?? id} ${formatHeight(gauge?.gageHeight?.value)}`,
    subtitle:
      [
        flow,
        provisional ? 'provisional' : null,
        'gage datum',
        gauge?.stale ? 'stale' : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    accent: gaugeStateColor(gauge?.stale).toCssColorString(),
    priority: gauge?.stale ? 100 : 1000,
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
  const timeMs = (() => {
    if (Number.isFinite(raw?.timeMs)) return raw.timeMs;
    const parsed = Date.parse(String(raw?.time ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.siteId) || `GAUGE-${String(index).padStart(4, '0')}`,
    site: text(raw?.name),
    dischargeCfs: num(raw?.dischargeCfs),
    gageHeightFt: num(raw?.gageHeightFt),
    gageDatum: true,
    provisional: raw?.provisional === true,
    stale: raw?.stale === true,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    time: text(raw?.time),
    timeMs,
  };
}
