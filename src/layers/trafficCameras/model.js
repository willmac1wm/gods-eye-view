import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';

export const TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID = 'traffic-cameras';
export const TRAFFIC_CAMERAS_OVERLAY_COHORT_LIMIT = 25;
export const TRAFFIC_CAMERAS_ATTRIBUTION =
  'NJDOT 511NJ (as-is) · DelDOT · Delaware River and Bay Authority';

const SOURCE_COLORS = Object.freeze({
  '511NJ': Cesium.Color.DODGERBLUE,
  'DelDOT TMC': Cesium.Color.LIMEGREEN,
  DelDOT: Cesium.Color.LIMEGREEN,
});

export function trafficCameraStateColor(camera, stale) {
  if (stale) return Cesium.Color.ORANGE;
  return SOURCE_COLORS[camera?.source] ?? Cesium.Color.SKYBLUE;
}

/** One overlay label per camera: road + source. */
export function createTrafficCameraOverlayEntry({ id, camera }) {
  const direction =
    Number.isFinite(camera?.heading) && camera.heading != null
      ? `faces ${Math.round(camera.heading)}°`
      : null;
  return {
    id: String(id),
    position: Cesium.Cartesian3.fromDegrees(camera.lng, camera.lat),
    variant: 'label',
    title: camera?.road
      ? `${camera.road} camera`
      : (camera?.name ?? msg('Traffic camera')),
    subtitle:
      [camera?.source, direction, camera?.stale ? 'stale' : null]
        .filter(Boolean)
        .join(' · ') || null,
    accent: trafficCameraStateColor(camera, camera?.stale).toCssColorString(),
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
    id: text(raw?.id) || `TRAFFIC-CAM-${String(index).padStart(4, '0')}`,
    name: text(raw?.name),
    road: text(raw?.road),
    source: text(raw?.source),
    headingDeg: num(raw?.heading),
    hasImage: raw?.imageUrl != null,
    stale: raw?.stale === true,
    lat: num(raw?.lat),
    lon: num(raw?.lng),
  };
}
