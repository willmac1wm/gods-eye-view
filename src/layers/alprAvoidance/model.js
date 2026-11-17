import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  ALPR_AVOIDANCE_FASTEST_COLOR,
  ALPR_AVOIDANCE_LOWEST_COLOR,
  ALPR_AVOIDANCE_OVERLAY_SOURCE_ID,
} from './policy.js';

/** Whole minutes, rounded — the panel and the label both speak in minutes. */
export function routeMinutes(route) {
  return Math.round((route?.durationS ?? 0) / 60);
}

/** Midpoint of a route's polyline (GeoJSON [lon, lat] order). */
export function routeMidpoint(route) {
  const geometry = route?.geometry;
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const [lon, lat] = geometry[Math.floor(geometry.length / 2)];
  return { lat, lon };
}

/**
 * One label at the fastest route's midpoint. The title carries the comparison
 * the layer exists for: fastest time and known-camera count, then the
 * lowest-exposure alternative and what it costs in minutes. "Known cameras"
 * is the honest wording — the ALPR layer holds mapped locations for its
 * viewport, not a census of every camera. When the ALPR layer holds no
 * records the label says the exposure is unknown instead of claiming zero.
 */
export function createAlprAvoidanceSummaryEntry({ snapshot } = {}) {
  const fastest = snapshot?.routes?.[snapshot.fastestIndex];
  const lowest = snapshot?.routes?.[snapshot.lowestIndex];
  const anchor = routeMidpoint(fastest) ??
    snapshot?.a ?? {
      lat: 39.0798,
      lon: -74.7625,
    };
  const fastestMinutes = routeMinutes(fastest);
  const title = !snapshot?.available
    ? `🛣️ ${msg('ALPR avoidance')}: ${msg('Place A and B in Directions')}`
    : snapshot.alprAvailable
      ? snapshot.sameRoute
        ? `🛣️ ${msg('Fastest')}: ${fastestMinutes} ${msg('min')} · ${fastest.cameraCount} ${msg('known cameras')} — ${msg('also the lowest-exposure route')}`
        : `🛣️ ${msg('Fastest')}: ${fastestMinutes} ${msg('min')} · ${fastest.cameraCount} ${msg('known cameras')} — ${msg('Lowest exposure')}: ${routeMinutes(lowest)} ${msg('min')} · ${lowest.cameraCount} ${msg('known cameras')}`
      : `🛣️ ${msg('Fastest')}: ${fastestMinutes} ${msg('min')} · ${msg('camera data unavailable')}`;
  const details = [];
  if (snapshot?.available) {
    if (snapshot.alprAvailable) {
      details.push(
        `${msg('Scored against')} ${snapshot.camerasConsidered} ${msg('known cameras')}`,
      );
      if (snapshot.alprStale) details.push(msg('Camera data is stale'));
      if (snapshot.alprSaturated)
        details.push(msg('Camera list capped — count is a lower bound'));
      if (!snapshot.sameRoute)
        details.push(
          `${msg('Lowest exposure costs')} ${routeMinutes(lowest) - fastestMinutes} ${msg('min more')}`,
        );
    } else {
      details.push(msg('Enable the ALPR layer to score exposure'));
    }
  }
  return {
    id: ALPR_AVOIDANCE_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat),
    variant: 'label',
    title,
    details,
    accent:
      snapshot?.available && snapshot.alprAvailable && !snapshot.sameRoute
        ? Cesium.Color.fromCssColorString(
            ALPR_AVOIDANCE_LOWEST_COLOR,
          ).toCssColorString()
        : Cesium.Color.fromCssColorString(
            ALPR_AVOIDANCE_FASTEST_COLOR,
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

/** One analyst row per scored route, so the comparison is queryable. */
export function mapAnalystRecord(route, kind) {
  if (!route) return null;
  return {
    id: `alpr-avoidance:${kind}`,
    kind,
    durationS: route.durationS,
    distanceM: route.distanceM,
    cameraCount: route.cameraCount,
    cameraIds: [...(route.cameraIds || [])],
  };
}

export function getAnalystRecords(snapshot) {
  if (!snapshot?.available) return [];
  const records = [];
  const fastest = mapAnalystRecord(
    snapshot.routes?.[snapshot.fastestIndex],
    'fastest',
  );
  if (fastest) records.push(fastest);
  // When the fastest route is also the lowest-exposure one there is only
  // one row — the two kinds are the same route, not two routes.
  if (!snapshot.sameRoute) {
    const lowest = mapAnalystRecord(
      snapshot.routes?.[snapshot.lowestIndex],
      'lowest',
    );
    if (lowest) records.push(lowest);
  }
  return records;
}
