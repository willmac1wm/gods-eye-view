// src/layers/navarea/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  NAVAREA_ATTRIBUTION,
  NAVAREA_OVERLAY_SOURCE_ID,
  NAVAREA_SOLAS_NOTE,
} from './policy.js';

export const NAVAREA_OVERLAY_COHORT_LIMIT = 150;
export const NAVAREA_ATTRIBUTION_TEXT = NAVAREA_ATTRIBUTION;
export const NAVAREA_SOLAS_NOTE_TEXT = NAVAREA_SOLAS_NOTE;

const CATEGORY_ACCENTS = Object.freeze({
  'live-fire': '#ff5a5a',
  wreck: '#ffb347',
  'drifting-object': '#ff7adf',
  'cable-work': '#39d5ff',
  'aid-to-navigation': '#7cff9b',
  survey: '#c9a7ff',
  other: '#d8d8d8',
});

/**
 * One label per warning at its first parsed position. Warnings with
 * no parseable position still list (in the panel / analyst seam),
 * just without a pin. The title carries the warning id and our
 * keyword category — categories are our reading, never NGA's own.
 */
export function createNavareaOverlayEntries({ warnings = [] }) {
  const pinned = warnings.filter(
    (warning) =>
      Array.isArray(warning.positions) && warning.positions.length > 0,
  );
  return pinned.slice(0, NAVAREA_OVERLAY_COHORT_LIMIT).map((warning) => {
    const first = warning.positions[0];
    const area = (warning.area ?? '').trim();
    const firstLine = (warning.text ?? '').split('.')[0]?.trim() ?? '';
    return {
      id: `${NAVAREA_OVERLAY_SOURCE_ID}-${warning.number}-${warning.year}`,
      position: Cesium.Cartesian3.fromDegrees(first.lon, first.lat),
      variant: 'label',
      title: `⚠ ${warning.id} · ${warning.category}`,
      subtitle: area
        ? `${area} — ${firstLine}`
        : firstLine || msg('NAVAREA warning'),
      accent: Cesium.Color.fromCssColorString(
        CATEGORY_ACCENTS[warning.category] ?? CATEGORY_ACCENTS.other,
      ).toCssColorString(),
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
    id: text(raw?.id) || `NAVAREA-${String(index).padStart(4, '0')}`,
    number: num(raw?.number),
    year: num(raw?.year),
    area: text(raw?.area),
    text: text(raw?.text),
    positions: (Array.isArray(raw?.positions) ? raw.positions : []).map(
      (position) => ({ lat: num(position?.lat), lon: num(position?.lon) }),
    ),
    positionParse: raw?.positionParse === true,
    category: text(raw?.category),
    issuedAt: text(raw?.issuedAt),
  };
}
