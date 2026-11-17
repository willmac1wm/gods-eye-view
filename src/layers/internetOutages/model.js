// src/layers/internetOutages/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT,
  INTERNET_OUTAGES_OVERLAY_SOURCE_ID,
} from './policy.js';

export { INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT };

/** County-seat anchor for the outage ticker overlay label (fuel pattern). */
export const INTERNET_OUTAGES_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});

/**
 * One anchor label over the county seat. Internet outages have no map
 * position of their own — the label reports the New Jersey scope and the
 * global critical count, and says which scope is quiet. An empty IODA
 * window is a real result ("no NJ outage events"), never an error state.
 */
export function createInternetOutagesOverlayEntry({ snapshot } = {}) {
  const njCount = snapshot?.counts?.njSummary ?? 0;
  const usCount = snapshot?.counts?.usSummary ?? 0;
  const critical = snapshot?.counts?.criticalAlerts ?? 0;
  const alertCount = snapshot?.counts?.alerts ?? 0;
  const njState =
    njCount > 0
      ? `${njCount} NJ ${njCount === 1 ? 'entity' : 'entities'} affected`
      : 'NJ quiet';
  return {
    id: INTERNET_OUTAGES_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      INTERNET_OUTAGES_COUNTY_CENTER.lon,
      INTERNET_OUTAGES_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: `🌐 ${msg('Internet outages')} · ${njState}`,
    subtitle:
      critical > 0
        ? `${critical} ${msg('critical')} · ${alertCount} ${msg('alerts worldwide (24 h)')} · ${usCount} ${msg('US entities')}`
        : `${alertCount} ${msg('alerts worldwide (24 h)')} · ${usCount} ${msg('US entities')}`,
    accent: Cesium.Color.fromCssColorString(
      critical > 0 ? '#ff6b6b' : '#7cff9b',
    ).toCssColorString(),
    priority: critical > 0 ? 2 : 1,
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
  if (raw?.kind === 'summary') {
    return {
      kind: 'summary',
      id:
        text(raw?.entityCode) ||
        `IODA-SUMMARY-${String(index).padStart(4, '0')}`,
      entityCode: text(raw?.entityCode),
      entityName: text(raw?.entityName),
      entityType: text(raw?.entityType),
      overallScore: num(raw?.overallScore),
      eventCount: num(raw?.eventCount),
    };
  }
  return {
    kind: 'alert',
    id:
      text(raw?.entityCode) && Number.isFinite(raw?.time)
        ? `IODA-${raw.entityCode}-${raw.time}`
        : `IODA-ALERT-${String(index).padStart(4, '0')}`,
    entityCode: text(raw?.entityCode),
    entityName: text(raw?.entityName),
    entityType: text(raw?.entityType),
    datasource: text(raw?.datasource),
    time: text(raw?.timeIso),
    level: text(raw?.level),
    condition: text(raw?.condition),
    method: text(raw?.method),
    value: num(raw?.value),
    historyValue: num(raw?.historyValue),
  };
}
