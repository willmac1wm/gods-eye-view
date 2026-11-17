// src/layers/fishing/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { FISHING_ATTRIBUTION, FISHING_OVERLAY_SOURCE_ID } from './policy.js';

export const FISHING_OVERLAY_COHORT_LIMIT = 100;
export const FISHING_ATTRIBUTION_TEXT = FISHING_ATTRIBUTION;

/**
 * One label per fishing vessel present in the box. The copy says
 * "present" — a fishing vessel underway is not necessarily fishing,
 * and "apparent fishing effort" belongs to Global Fishing Watch's
 * model, not to AIS presence.
 */
export function createFishingOverlayEntries({ vessels = [] }) {
  return vessels.slice(0, FISHING_OVERLAY_COHORT_LIMIT).map((row) => {
    const speed =
      row.speedKts === null || row.speedKts === undefined
        ? null
        : `${row.speedKts} kn`;
    return {
      id: `${FISHING_OVERLAY_SOURCE_ID}-${row.mmsi}`,
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      variant: 'label',
      title: `🎣 ${row.name ?? row.mmsi}${speed ? ` · ${speed}` : ''}`,
      subtitle: `${msg('Fishing vessel present')} · ${msg('MMSI')} ${row.mmsi}`,
      accent: Cesium.Color.fromCssColorString('#7cff9b').toCssColorString(),
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
  return {
    id: text(raw?.mmsi) || `FISHING-${String(index).padStart(4, '0')}`,
    mmsi: text(raw?.mmsi),
    imo: text(raw?.imo),
    name: text(raw?.name),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    speedKts: num(raw?.speedKts),
    courseDeg: num(raw?.courseDeg),
    shipType: text(raw?.shipType),
    destination: text(raw?.destination),
    lastSeenMs: num(raw?.lastSeenMs ?? raw?.lastPositionEpoch),
  };
}
