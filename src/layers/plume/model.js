// src/layers/plume/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  PLUME_DEFAULT_RELEASE,
  PLUME_OVERLAY_COHORT_LIMIT,
  PLUME_OVERLAY_SOURCE_ID,
} from './policy.js';
import { degreesToCompass, downwindBearing } from './records.js';

export { PLUME_OVERLAY_COHORT_LIMIT };

/** Release-point anchor for the plume ticker overlay label (fuel pattern). */
export const PLUME_RELEASE_CENTER = Object.freeze({
  lat: PLUME_DEFAULT_RELEASE.lat,
  lon: PLUME_DEFAULT_RELEASE.lon,
});

/**
 * One anchor label over the release point. The plume geometry itself
 * (path polyline, cone polygon, EPZ circle) is drawn by rendering.js —
 * the overlay host carries labels only. The label reports the downwind
 * direction and the 24-hour reach, and carries the two disclaimers on
 * every view via `details` (the rendered secondary lines — `subtitle`
 * is dropped by the overlay normalizer, so disclaimers live here, not
 * there): advection-only / not a HYSPLIT run, and planning-aid-only.
 */
export function createFalloutPlumeOverlayEntry({ snapshot } = {}) {
  const firstWind = snapshot?.winds?.[0] ?? null;
  const downwind =
    firstWind && Number.isFinite(firstWind.directionFrom)
      ? degreesToCompass(downwindBearing(firstWind.directionFrom))
      : null;
  const distanceMi = snapshot?.distanceMi;
  return {
    id: PLUME_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      PLUME_RELEASE_CENTER.lon,
      PLUME_RELEASE_CENTER.lat,
    ),
    variant: 'label',
    title:
      downwind !== null
        ? `☢️ ${msg('Fallout plume')} · ${downwind}`
        : `☢️ ${msg('Fallout plume')}`,
    details: [
      Number.isFinite(distanceMi)
        ? `${Math.round(distanceMi)} ${msg('mi in 24 h')}`
        : msg('Plume unavailable — no wind data'),
      msg('Advection only — not a HYSPLIT run'),
      msg('Planning aid only — follow official guidance'),
    ],
    accent: Cesium.Color.fromCssColorString('#ff8c42').toCssColorString(),
    priority: 2,
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

/** Analyst seam. Pure — no Cesium types. Dispatches on the row kind. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  if (raw?.kind === 'wind') {
    return {
      kind: 'wind',
      id: text(raw?.time)
        ? `PLUME-WIND-${raw.time}`
        : `PLUME-WIND-${String(index).padStart(4, '0')}`,
      time: text(raw?.time),
      timeIso: text(raw?.timeIso),
      speedMph: num(raw?.speedMph),
      directionFrom: num(raw?.directionFrom),
      downwindBearing: downwindBearing(num(raw?.directionFrom)),
      source: 'NWS api.weather.gov',
    };
  }
  return {
    kind: 'node',
    id: `PLUME-NODE-${String(raw?.hour ?? index).padStart(2, '0')}`,
    hour: num(raw?.hour),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    time: text(raw?.time),
    distanceMi: num(raw?.distanceMi),
    calm: raw?.calm === true,
    source: 'NWS api.weather.gov',
  };
}
