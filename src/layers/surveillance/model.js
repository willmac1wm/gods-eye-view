import * as Cesium from 'cesium';
import { SURVEILLANCE_COLOR } from './policy.js';

export const SURVEILLANCE_OVERLAY_SOURCE_ID = 'surveillance-cameras';
export const SURVEILLANCE_OVERLAY_COHORT_LIMIT = 25;
export const SURVEILLANCE_ATTRIBUTION =
  'Source: OpenStreetMap contributors (ODbL 1.0), community mapped';

export const SURVEILLANCE_STATE_COLORS = Object.freeze({
  current: Cesium.Color.fromCssColorString(SURVEILLANCE_COLOR),
  stale: Cesium.Color.ORANGE,
});

export function surveillanceStateColor(stale) {
  return stale
    ? SURVEILLANCE_STATE_COLORS.stale
    : SURVEILLANCE_STATE_COLORS.current;
}

function cameraLabel(camera) {
  if (camera?.zone) return `${camera.zone} camera`;
  return 'Surveillance camera';
}

/** One overlay label per camera: "parking camera" + operator/manufacturer. */
export function createSurveillanceOverlayEntry({ id, camera }) {
  const direction =
    Number.isFinite(camera?.directionDeg) && camera.directionDeg != null
      ? `faces ${Math.round(camera.directionDeg)}°`
      : null;
  return {
    id: String(id),
    position: Cesium.Cartesian3.fromDegrees(camera.longitude, camera.latitude),
    variant: 'label',
    title: cameraLabel(camera),
    subtitle:
      [
        camera?.manufacturer,
        camera?.operator,
        camera?.cameraType,
        direction,
        'community mapped',
        camera?.stale ? 'stale' : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    accent: surveillanceStateColor(camera?.stale).toCssColorString(),
    priority: camera?.stale ? 100 : 1000,
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
  return {
    id: text(raw?.id) || `SURV-${String(index).padStart(4, '0')}`,
    site: text(raw?.operator),
    manufacturer: text(raw?.manufacturer),
    cameraType: text(raw?.cameraType),
    zone: text(raw?.zone),
    directionDeg: num(raw?.directionDeg),
    stale: raw?.stale === true,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
  };
}
