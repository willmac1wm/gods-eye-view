import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { DROUGHT_CATEGORIES } from './records.js';
/** County-seat anchor for the drought overlay label. */
export const DROUGHT_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const DROUGHT_OVERLAY_SOURCE_ID = 'drought';
export const DROUGHT_OVERLAY_COHORT_LIMIT = 1;
export const DROUGHT_ATTRIBUTION =
  'U.S. Drought Monitor (droughtmonitor.unl.edu)';

/** Short release-date label from an HTTP date or ISO string. */
export function releaseLabel(releasedAt) {
  if (typeof releasedAt !== 'string' || !releasedAt.trim()) return null;
  const ms = Date.parse(releasedAt);
  if (!Number.isFinite(ms)) return releasedAt;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * One drought overlay label over the county seat: the county category
 * (or the all-clear line when the county is in no drought polygon) plus
 * the map release date.
 */
export function createDroughtOverlayEntry({ snapshot }) {
  const category = snapshot?.category;
  const info = category != null ? DROUGHT_CATEGORIES[category] : null;
  const released = releaseLabel(snapshot?.releasedAt);
  return {
    id: 'drought',
    position: Cesium.Cartesian3.fromDegrees(
      DROUGHT_COUNTY_CENTER.lon,
      DROUGHT_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: info
      ? `💧 ${msg('Drought')}: ${info.code} ${msg(info.name)}`
      : `💧 ${msg('No drought')}`,
    subtitle: released
      ? `${msg('U.S. Drought Monitor')} · ${msg('map of')} ${released}`
      : msg('U.S. Drought Monitor'),
    accent: (category == null
      ? Cesium.Color.LIMEGREEN
      : category === 0
        ? Cesium.Color.YELLOW
        : category === 1
          ? Cesium.Color.GOLD
          : category === 2
            ? Cesium.Color.ORANGE
            : Cesium.Color.RED
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
    const parsed = Date.parse(String(raw?.releasedAt ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.id) || `DROUGHT-${String(index).padStart(4, '0')}`,
    category: num(raw?.category),
    code: text(raw?.code),
    name: text(raw?.name),
    releasedAt: text(raw?.releasedAt),
    time: text(raw?.releasedAt),
    timeMs,
  };
}
