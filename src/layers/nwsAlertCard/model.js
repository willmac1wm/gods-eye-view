import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
/** County-seat anchor for the alert-card overlay label. */
export const NWS_ALERT_CARD_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const NWS_ALERT_CARD_OVERLAY_SOURCE_ID = 'nws-alert-card';
export const NWS_ALERT_CARD_OVERLAY_COHORT_LIMIT = 1;
export const NWS_ALERT_CARD_ATTRIBUTION =
  'National Weather Service / NWS Mount Holly';

/**
 * One alert-card overlay label over the county seat: the active-alert
 * count, or the all-clear line. Zero active alerts is the steady state,
 * not an error — the label says so.
 */
export function createNwsAlertCardOverlayEntry({ snapshot }) {
  const count = snapshot?.alerts?.length ?? 0;
  const worst = snapshot?.alerts?.find(
    (alert) => alert.severity === 'Extreme' || alert.severity === 'Severe',
  );
  return {
    id: 'nws-alert-card',
    position: Cesium.Cartesian3.fromDegrees(
      NWS_ALERT_CARD_COUNTY_CENTER.lon,
      NWS_ALERT_CARD_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title:
      count === 0
        ? `✓ ${msg('No active NWS alerts')}`
        : `⚠ ${count} ${msg('active NWS alert')}${count === 1 ? '' : 's'}`,
    subtitle:
      count === 0
        ? msg('Cape May County')
        : (worst?.plain ??
          snapshot.alerts[0]?.plain ??
          snapshot.alerts[0]?.event ??
          null),
    accent: (worst
      ? Cesium.Color.RED
      : count > 0
        ? Cesium.Color.ORANGE
        : Cesium.Color.LIMEGREEN
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
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const timeMs = (() => {
    const parsed = Date.parse(String(raw?.effective ?? raw?.onset ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.id) || `NWS-ALERT-${String(index).padStart(4, '0')}`,
    event: text(raw?.event),
    plain: text(raw?.plain),
    // The official instruction text (D9 reads it for evacuation guidance:
    // evacuation instructions come only from official sources, quoted).
    instruction: text(raw?.instruction),
    severity: text(raw?.severity),
    severityWords: text(raw?.severityWords),
    area: text(raw?.area),
    headline: text(raw?.headline),
    effective: text(raw?.effective),
    expires: text(raw?.expires),
    time: text(raw?.effective),
    timeMs,
  };
}
