import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { OUTAGES_COUNTY_CENTER } from './records.js';
export const OUTAGES_OVERLAY_SOURCE_ID = 'outages';
export const OUTAGES_OVERLAY_COHORT_LIMIT = 16;
export const OUTAGES_ATTRIBUTION =
  'MassOutage (massoutage.com), unofficial aggregate';

export const OUTAGE_SEVERITY_COLORS = Object.freeze({
  none: Cesium.Color.SKYBLUE,
  watch: Cesium.Color.YELLOW,
  minor: Cesium.Color.YELLOW,
  moderate: Cesium.Color.ORANGE,
  major: Cesium.Color.RED,
});

export function severityColor(severity) {
  return OUTAGE_SEVERITY_COLORS[severity] ?? OUTAGE_SEVERITY_COLORS.none;
}

const SEVERITY_RANK = Object.freeze({
  none: 0,
  watch: 1,
  minor: 2,
  moderate: 3,
  major: 4,
});

/** One overlay label per affected town: "OCEAN CITY 85 out · 0.4%". */
export function createOutagesOverlayEntry({ id, area, severity }) {
  const out =
    area?.customersOut == null ? 'unknown out' : `${area.customersOut} out`;
  const pct = area?.pctOut == null ? '' : ` · ${area.pctOut.toFixed(1)}%`;
  return {
    id: String(id),
    position: Cesium.Cartesian3.fromDegrees(area.lon, area.lat),
    variant: 'label',
    title: `${area?.name ?? id} ${out}`,
    subtitle: pct.trim() ? pct.trim() : null,
    accent: severityColor(severity).toCssColorString(),
    priority:
      (SEVERITY_RANK[severity] ?? 0) * 1000 +
      Math.round(area?.customersOut ?? 0),
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

/** County summary overlay label at the county seat. */
export function createOutagesCountyOverlayEntry({ county, majorEvent }) {
  const out =
    county?.customersOut == null
      ? 'outages unknown'
      : county.customersOut === 0
        ? 'no outages reported'
        : `${county.customersOut.toLocaleString('en-US')} customers out`;
  return {
    id: 'outages-county',
    position: Cesium.Cartesian3.fromDegrees(
      OUTAGES_COUNTY_CENTER.lon,
      OUTAGES_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: `${msg('Cape May County')} — ${out}`,
    subtitle: majorEvent ? msg('MAJOR EVENT (≥10% of a utility out)') : null,
    accent: severityColor(majorEvent ? 'major' : 'none').toCssColorString(),
    priority: majorEvent ? 5000 : 0,
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
    const parsed = Date.parse(String(raw?.asOf ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.name) || `OUTAGE-${String(index).padStart(4, '0')}`,
    area: text(raw?.name),
    customersOut: num(raw?.customersOut),
    customersServed: num(raw?.customersServed),
    pctOut: num(raw?.pctOut),
    severity: text(raw?.severity),
    etr: text(raw?.etr),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    time: text(raw?.asOf),
    timeMs,
  };
}
