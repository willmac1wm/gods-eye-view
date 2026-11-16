import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
/** County-seat anchor for the history ticker overlay label. */
export const DISASTER_HISTORY_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const DISASTER_HISTORY_OVERLAY_SOURCE_ID = 'disaster-history';
export const DISASTER_HISTORY_OVERLAY_COHORT_LIMIT = 1;
export const DISASTER_HISTORY_ATTRIBUTION =
  'Sources: FEMA OpenFEMA; NOAA NCEI Storm Events Database';

function yearLabel(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}/.test(isoDate)) return null;
  return isoDate.slice(0, 4);
}

/**
 * One history-ticker overlay label over the county seat: the declaration
 * count and the most recent declaration. The Storm Events half lives in
 * the panel, not on the map — history is a timeline, not pins.
 */
export function createDisasterHistoryOverlayEntry({ snapshot }) {
  const count =
    snapshot?.declarationCount ?? snapshot?.declarations?.length ?? 0;
  const latest = Array.isArray(snapshot?.declarations)
    ? snapshot.declarations[0]
    : null;
  const latestYear = yearLabel(latest?.declarationDate);
  const latestTitle = latest?.declarationTitle
    ? latest.declarationTitle.charAt(0) +
      latest.declarationTitle.slice(1).toLowerCase()
    : null;
  return {
    id: 'disaster-history',
    position: Cesium.Cartesian3.fromDegrees(
      DISASTER_HISTORY_COUNTY_CENTER.lon,
      DISASTER_HISTORY_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: `🌀 ${msg('Federal disasters')}: ${count} ${msg('since')} ${latest ? yearLabel(snapshot.declarations.at(-1)?.declarationDate) : '—'}`,
    subtitle:
      latest && latestYear
        ? `${msg('Latest')}: ${latest.incidentType} — ${latestTitle ?? ''} (${latestYear})`.trim()
        : msg('No declarations on record'),
    accent: Cesium.Color.ORANGE.toCssColorString(),
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
    const parsed = Date.parse(String(raw?.declarationDate ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.id) || `DISASTER-${String(index).padStart(4, '0')}`,
    declarationType: text(raw?.declarationType),
    incidentType: text(raw?.incidentType),
    title: text(raw?.declarationTitle),
    declarationDate: text(raw?.declarationDate),
    incidentBeginDate: text(raw?.incidentBeginDate),
    incidentEndDate: text(raw?.incidentEndDate),
    publicAssistance: raw?.programs?.publicAssistance === true,
    individualAssistance: raw?.programs?.individualAssistance === true,
    hazardMitigation: raw?.programs?.hazardMitigation === true,
    disasterNumber: num(raw?.disasterNumber),
    time: text(raw?.declarationDate),
    timeMs,
  };
}
