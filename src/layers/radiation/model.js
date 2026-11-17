import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
/** County-seat anchor for the radiation overlay label. */
export const RADIATION_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const RADIATION_OVERLAY_SOURCE_ID = 'radiation';
export const RADIATION_OVERLAY_COHORT_LIMIT = 1;
export const RADIATION_ATTRIBUTION = 'EPA RadNet · Safecast (CC0)';

/**
 * One radiation overlay label over the county seat: the nearest
 * monitor's dose rate, with the second monitor in the subtitle. Both
 * monitors are regional background — the label never claims a county
 * reading.
 */
export function createRadiationOverlayEntry({ snapshot }) {
  const first = snapshot?.monitors?.[0] ?? null;
  const second = snapshot?.monitors?.[1] ?? null;
  return {
    id: 'radiation',
    position: Cesium.Cartesian3.fromDegrees(
      RADIATION_COUNTY_CENTER.lon,
      RADIATION_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: first
      ? `☢️ ${first.doseRateNSvH} ${msg('nSv/h')} · ${msg(first.name)}`
      : `☢️ ${msg('Radiation unavailable')}`,
    subtitle: second
      ? `${second.name} ${second.doseRateNSvH} ${msg('nSv/h')} · ${msg('regional background')}`
      : msg('Regional background — no monitor in the county'),
    accent: Cesium.Color.PALEGREEN.toCssColorString(),
    priority: 0,
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
    const parsed = Date.parse(String(raw?.sampleTime ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.key) || `RADIATION-${String(index).padStart(4, '0')}`,
    monitor: text(raw?.name),
    state: text(raw?.state),
    doseRateNSvH: num(raw?.doseRateNSvH),
    gammaCpmR02: num(raw?.gammaCpmR02),
    distanceKm: num(raw?.distanceKm),
    sampleTime: text(raw?.sampleTime),
    time: text(raw?.sampleTime),
    timeMs,
  };
}
