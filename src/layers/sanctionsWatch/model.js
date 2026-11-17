// src/layers/sanctionsWatch/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { isSanctionsMatch } from './records.js';
import {
  SANCTIONS_ATTRIBUTION,
  SANCTIONS_OVERLAY_SOURCE_ID,
} from './policy.js';

export const SANCTIONS_OVERLAY_COHORT_LIMIT = 25;
export const SANCTIONS_ATTRIBUTION_TEXT = SANCTIONS_ATTRIBUTION;

/**
 * One label per flagged vessel at its last known position. A sanctions
 * match is red; a dark-vessel signal without a match is amber. The label
 * states the signal and the screening outcome — it never says "this
 * vessel is sanctioned" without the match detail, and a GREEN screening
 * is worded as "no matches found in the sources screened".
 */
export function createSanctionsOverlayEntries({ flagged = [] }) {
  return flagged.slice(0, SANCTIONS_OVERLAY_COHORT_LIMIT).map((row) => {
    const match = isSanctionsMatch(row.screening);
    const signals = (row.signals ?? []).map((signal) => signal.kind);
    const title = `⚓ ${row.name ?? row.mmsi} · ${signals.join(', ') || msg('flagged')}`;
    const subtitle = row.screening
      ? match
        ? `${msg('Sanctions match')} · ${row.screening.vettingGrade ? `vetting ${row.screening.vettingGrade}` : ''}`.trim()
        : `${msg('No matches')} · ${row.screening.checkedAt ?? ''}`.trim()
      : msg('AIS signal only — not yet screened');
    return {
      id: `${SANCTIONS_OVERLAY_SOURCE_ID}-${row.mmsi}`,
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      variant: 'label',
      title,
      subtitle,
      accent: match
        ? Cesium.Color.RED.toCssColorString()
        : Cesium.Color.ORANGE.toCssColorString(),
      priority: 1,
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
  });
}

/** Analyst seam. Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const screening = raw?.screening ?? null;
  return {
    id: text(raw?.mmsi) || `SANCTIONS-${String(index).padStart(4, '0')}`,
    mmsi: text(raw?.mmsi),
    imo: text(raw?.imo),
    name: text(raw?.name),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    signals: (raw?.signals ?? []).map((signal) => signal.kind ?? signal),
    signalDetails: (raw?.signals ?? []).map(
      (signal) => signal.detail ?? String(signal),
    ),
    sanctionsStatus: screening ? text(screening.sanctionsStatus) : null,
    sanctionsMatch: isSanctionsMatch(screening),
    vettingGrade: screening ? text(screening.vettingGrade) : null,
    checkedAt: screening ? text(screening.checkedAt) : null,
    lastSeenMs: num(raw?.lastSeenMs ?? raw?.lastPositionEpoch),
    fullReport: screening ? text(screening.fullReport) : null,
  };
}
