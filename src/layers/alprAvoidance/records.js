/**
 * Pure ALPR-avoidance scoring. A camera counts against a route when it lies
 * within the exposure radius of the route polyline. Distances use an
 * equirectangular projection — accurate to well under a metre at 90 m scale —
 * so the scorer stays pure and fixture-testable with no map dependency.
 * Nothing here knows about plates, reads or feeds: the input is a list of
 * camera LOCATIONS (the A5 layer's analyst records), and the output is a
 * count per route.
 */
import { ALPR_AVOIDANCE_EXPOSURE_RADIUS_M } from './policy.js';

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Distance in metres from a point to one polyline segment, on the local
 * equirectangular plane around the segment midpoint. The segment endpoints
 * are [lon, lat] (GeoJSON order, as OSRM returns them).
 */
export function pointToSegmentM(lat, lon, [lon1, lat1], [lon2, lat2]) {
  const midLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const toXy = (la, lo) => [
    ((lo * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(midLat),
    ((la * Math.PI) / 180) * EARTH_RADIUS_M,
  ];
  const [px, py] = toXy(lat, lon);
  const [ax, ay] = toXy(lat1, lon1);
  const [bx, by] = toXy(lat2, lon2);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToPolylineM(lat, lon, geometry) {
  if (!Array.isArray(geometry) || geometry.length === 0) return Infinity;
  if (geometry.length === 1)
    return haversineM(lat, lon, geometry[0][1], geometry[0][0]);
  let best = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    best = Math.min(
      best,
      pointToSegmentM(lat, lon, geometry[i], geometry[i + 1]),
    );
  }
  return best;
}

/**
 * Score one route against the known cameras. A camera counts once per route
 * even when it is near several segments.
 * @param {object} route { distanceM, durationS, geometry: [[lon, lat], ...] }
 * @param {Array} cameras [{ id, lat, lon }] — the ALPR analyst records.
 * @param {number} radiusM Defaults to the ALPR direction-cone radius (90 m).
 * @returns {{cameraCount: number, cameraIds: string[], onRoute: Array}}
 */
export function scoreRoute(
  route,
  cameras,
  radiusM = ALPR_AVOIDANCE_EXPOSURE_RADIUS_M,
) {
  const onRoute = [];
  for (const camera of cameras || []) {
    if (typeof camera?.lat !== 'number' || typeof camera?.lon !== 'number')
      continue;
    const distanceM = distanceToPolylineM(
      camera.lat,
      camera.lon,
      route?.geometry,
    );
    if (distanceM <= radiusM)
      onRoute.push({
        id: camera.id,
        lat: camera.lat,
        lon: camera.lon,
        distanceM,
      });
  }
  return {
    cameraCount: onRoute.length,
    cameraIds: onRoute.map((camera) => camera.id),
    onRoute,
  };
}

/** Score every route; the route fields pass through untouched. */
export function scoreRoutes(routes, cameras, radiusM) {
  return (routes || []).map((route) => ({
    ...route,
    ...scoreRoute(route, cameras, radiusM),
  }));
}

/**
 * Pick the fastest route (shortest duration) and the lowest-exposure route
 * (fewest known cameras, ties broken by duration). Returns the indices into
 * the scored array, plus whether they are the same route.
 */
export function pickFastestAndLowest(scored) {
  if (!Array.isArray(scored) || scored.length === 0)
    return { fastestIndex: -1, lowestIndex: -1, sameRoute: false };
  let fastestIndex = 0;
  let lowestIndex = 0;
  for (let i = 1; i < scored.length; i++) {
    if (scored[i].durationS < scored[fastestIndex].durationS) fastestIndex = i;
    const a = scored[i];
    const b = scored[lowestIndex];
    if (
      a.cameraCount < b.cameraCount ||
      (a.cameraCount === b.cameraCount && a.durationS < b.durationS)
    )
      lowestIndex = i;
  }
  return {
    fastestIndex,
    lowestIndex,
    sameRoute: fastestIndex === lowestIndex,
  };
}

/** Shape check for a snapshot the source produced. */
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object')
    return ['snapshot is not an object'];
  const errors = [];
  if (!Array.isArray(snapshot.routes)) errors.push('routes is not an array');
  if (typeof snapshot.fastestIndex !== 'number')
    errors.push('fastestIndex is not a number');
  if (typeof snapshot.lowestIndex !== 'number')
    errors.push('lowestIndex is not a number');
  if (typeof snapshot.camerasConsidered !== 'number')
    errors.push('camerasConsidered is not a number');
  if (typeof snapshot.alprAvailable !== 'boolean')
    errors.push('alprAvailable is not a boolean');
  if (typeof snapshot.fetchedAt !== 'number')
    errors.push('fetchedAt is not a number');
  return errors;
}
