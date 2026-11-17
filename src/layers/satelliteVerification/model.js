import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  GIBS_SOURCES,
  SATELLITE_COUNTY_CENTER,
  SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID,
} from './policy.js';

const GIBS_LABELS = new Map(GIBS_SOURCES.map((s) => [s.id, s.label]));

export function gibsLabel(sourceId) {
  return GIBS_LABELS.get(sourceId) ?? sourceId ?? null;
}

/** One county label for the active (A) date. The title carries the date
 * and the source that served it; the details carry the tile status (live
 * / nearest available / none) and the Sentinel-2 catalogue note. A date
 * with no imagery says so — never a neighbouring date's tile presented
 * as the requested date. */
export function createSatelliteSummaryEntry({ snapshot } = {}) {
  const status = snapshot?.tileStatus ?? 'none';
  const accent =
    status === 'live'
      ? Cesium.Color.fromCssColorString('#7aa5ff')
      : status === 'nearest'
        ? Cesium.Color.ORANGE
        : Cesium.Color.GRAY;
  const title =
    status === 'none'
      ? `🛰️ ${msg('Satellite')}: ${msg('No imagery')} ${snapshot?.requestedDate ?? ''}`
      : `🛰️ ${msg('Satellite')}: ${snapshot.date} · ${gibsLabel(snapshot.source)}`;
  const details = [
    status === 'live'
      ? msg('True-color imagery for the requested date')
      : status === 'nearest'
        ? `${msg('Nearest imagery available')}: ${snapshot.date} (${msg('requested')} ${snapshot.requestedDate})`
        : `${msg('No imagery for this date')} — ${msg('try an earlier date')}`,
    snapshot?.catalogueAvailable
      ? `${msg('Sentinel-2 products')}: ${snapshot.products?.length ?? 0}`
      : msg('Sentinel-2 catalogue unavailable'),
  ];
  return {
    id: SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      SATELLITE_COUNTY_CENTER.lon,
      SATELLITE_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title,
    details,
    accent: accent.toCssColorString(),
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

/** Compare (B) date label, drawn only while the compare drape is on. */
export function createSatelliteCompareEntry({ snapshot } = {}) {
  if (!snapshot || snapshot.tileStatus === 'none') return null;
  return {
    id: `${SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID}-compare`,
    position: Cesium.Cartesian3.fromDegrees(
      SATELLITE_COUNTY_CENTER.lon,
      SATELLITE_COUNTY_CENTER.lat + 0.06,
    ),
    variant: 'label',
    title: `🛰️ ${msg('Compare')}: ${snapshot.date} · ${gibsLabel(snapshot.source)}`,
    details: [
      snapshot.tileStatus === 'nearest'
        ? `${msg('Nearest imagery available')}: ${snapshot.date}`
        : msg('True-color imagery for the requested date'),
    ],
    accent: Cesium.Color.fromCssColorString('#9fd6a4').toCssColorString(),
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
}

/** Analyst seam. Pure — no Cesium types. One row per Sentinel-2 product. */
export function mapAnalystRecord(product, index = 0) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(product?.id) ?? `SENTINEL-${String(index).padStart(4, '0')}`,
    name: text(product?.name),
    sensingDate: text(product?.sensingDate),
    tile: text(product?.tile),
    level: text(product?.level),
    countyTile: product?.countyTile === true,
  };
}
