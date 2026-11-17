import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { auroraOutlook } from './records.js';
/** County-seat anchor for the space-weather overlay label. */
export const SPACE_WEATHER_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const SPACE_WEATHER_OVERLAY_SOURCE_ID = 'space-weather';
export const SPACE_WEATHER_OVERLAY_COHORT_LIMIT = 1;
export const SPACE_WEATHER_ATTRIBUTION = 'NOAA Space Weather Prediction Center';

/**
 * One space-weather overlay label over the county seat: current Kp +
 * activity, and the forecast maximum with the honest aurora line.
 */
export function createSpaceWeatherOverlayEntry({ snapshot }) {
  const kp = snapshot?.kp?.kp;
  const forecastMax = snapshot?.forecast?.maxKp;
  const scale = snapshot?.kp?.gScale ?? null;
  return {
    id: 'space-weather',
    position: Cesium.Cartesian3.fromDegrees(
      SPACE_WEATHER_COUNTY_CENTER.lon,
      SPACE_WEATHER_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: Number.isFinite(kp)
      ? `☀️ ${msg('Kp')} ${kp}${scale ? ` (${scale})` : ''} · ${msg(snapshot.kp.activity)}`
      : `☀️ ${msg('Kp unavailable')}`,
    subtitle: Number.isFinite(forecastMax)
      ? `${msg('Max expected')} ${msg('Kp')} ${forecastMax} · ${auroraOutlook(forecastMax)}`
      : auroraOutlook(kp),
    accent: (Number.isFinite(kp) && kp >= 7
      ? Cesium.Color.RED
      : Number.isFinite(kp) && kp >= 5
        ? Cesium.Color.ORANGE
        : Cesium.Color.SKYBLUE
    ).toCssColorString(),
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
    const parsed = Date.parse(String(raw?.timeTag ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.id) || `SPACE-WEATHER-${String(index).padStart(4, '0')}`,
    kp: num(raw?.kp),
    gScale: text(raw?.gScale),
    activity: text(raw?.activity),
    forecastMaxKp: num(raw?.forecastMaxKp),
    solarWindSpeed: num(raw?.solarWindSpeed),
    bzGsm: num(raw?.bzGsm),
    time: text(raw?.timeTag),
    timeMs,
  };
}
