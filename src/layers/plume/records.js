// src/layers/plume/records.js
// Pure plume math for the fallout-plume layer: NWS wind parsing, the
// compass → downwind-bearing conversion, hourly advection stepping, the
// 15° cone builder, and the 10-mile EPZ reference circle. No network,
// no Cesium, no clock.
//
// The model is advection only: each hour the plume centroid moves
// downwind by windSpeed × 1 h, along the downwind bearing (the
// direction the wind blows TOWARD — NWS windDirection is the direction
// FROM which it blows, so the bearing is FROM + 180°). There is no
// deposition, no chemistry/decay, no plume rise, no terrain, no
// upper-air shear. A calm hour stalls the centroid and widens the cone
// 1 mile in place (pooling) instead of dividing by zero or drawing
// nothing. A missing wind ends the path early (stoppedEarly), never
// guessed forward. The cone is a fixed 15° half-angle spread, not a
// turbulence model. Distances use the spherical destination-point
// formula (Earth radius 3958.8 mi); at plume scales (≤ ~250 mi) the
// error vs an ellipsoid is far below the model's own uncertainty.
import {
  PLUME_CALM_POOL_MI_PER_HOUR,
  PLUME_CONE_HALF_ANGLE_DEG,
  PLUME_DEFAULT_RELEASE,
  PLUME_EARTH_RADIUS_MI,
  PLUME_EPZ_CIRCLE_POINTS,
  PLUME_EPZ_RADIUS_MI,
  PLUME_HORIZON_HOURS,
} from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/** 16-point compass → degrees (direction FROM which the wind blows). */
export const COMPASS_DEGREES = Object.freeze({
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
});

/**
 * Parse an NWS wind direction ("NW", "315", 315) to degrees FROM which
 * the wind blows, or null when unparseable. Numeric degrees pass
 * through (normalized to 0–360).
 */
export function parseWindDirection(value) {
  if (typeof value === 'number' && Number.isFinite(value))
    return ((value % 360) + 360) % 360;
  const text = textValue(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (Object.hasOwn(COMPASS_DEGREES, upper)) return COMPASS_DEGREES[upper];
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return ((numeric % 360) + 360) % 360;
  return null;
}

/** Downwind bearing (direction TOWARD which the wind blows) from a FROM direction. */
export function downwindBearing(directionFromDeg) {
  if (!Number.isFinite(directionFromDeg)) return null;
  return (directionFromDeg + 180) % 360;
}

/** Degrees → nearest 8-point compass label (N, NE, E, SE, S, SW, W, NW). */
export function degreesToCompass(degrees) {
  if (!Number.isFinite(degrees)) return null;
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return labels[index];
}

/**
 * Parse an NWS windSpeed string ("5 mph", "5 to 10 mph", "calm") to
 * mph, or null when unparseable. A range averages (documented: the
 * plume steps on the range midpoint, not the optimistic end).
 */
export function parseWindSpeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = textValue(value);
  if (!text) return null;
  if (text.toLowerCase() === 'calm') return 0;
  const numbers = text.match(/(\d+(?:\.\d+)?)/g);
  if (!numbers) return null;
  const parsed = numbers.map(Number).filter(Number.isFinite);
  if (parsed.length === 0) return null;
  if (parsed.length === 1) return parsed[0];
  return (parsed[0] + parsed[1]) / 2;
}

/**
 * Parse one NWS hourly forecast period to a wind row
 * ({time, timeIso, speedMph, directionFrom}) or null when it carries
 * no usable wind. NWS windSpeed is a string ("5 mph"); windDirection
 * is a compass string ("NW").
 */
export function parseNwsHourlyPeriod(period) {
  if (!period || typeof period !== 'object' || Array.isArray(period))
    return null;
  const time = textValue(period.startTime);
  if (!time) return null;
  const speedMph = parseWindSpeed(period.windSpeed);
  if (speedMph === null) return null;
  const directionFrom = parseWindDirection(period.windDirection);
  if (directionFrom === null) return null;
  const parsed = Date.parse(time);
  return {
    time,
    timeIso: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
    speedMph,
    directionFrom,
  };
}

/** Parse an NWS hourly forecast payload to wind rows (period order kept). */
export function parseNwsHourlyForecast(payload) {
  const periods = payload?.properties?.periods;
  if (!Array.isArray(periods)) return null;
  const winds = [];
  for (const period of periods) {
    const row = parseNwsHourlyPeriod(period);
    if (row) winds.push(row);
  }
  return winds;
}

/**
 * Destination point: where a start lat/lon ends up after traveling
 * distanceMi along bearingDeg (spherical Earth).
 */
export function destinationPoint({ lat, lon }, bearingDeg, distanceMi) {
  const radius = PLUME_EARTH_RADIUS_MI;
  const angular = distanceMi / radius;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/** Great-circle distance between two {lat, lon} points, in miles. */
export function haversineMi(a, b) {
  const radius = PLUME_EARTH_RADIUS_MI;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Step the plume hour by hour from the release point along the wind
 * rows. Returns {path, distanceMi, calmHours, stoppedEarly, windsUsed}.
 * Each path node carries {lat, lon, time, hour, distanceMi, poolMi,
 * bearing, calm}. A calm hour repeats the position (pooling) and adds
 * PLUME_CALM_POOL_MI_PER_HOUR to the cone width from then on. A wind
 * row without speed/direction ends the path (stoppedEarly), never
 * guessed forward.
 */
export function stepPlume({
  release,
  winds,
  horizonHours = PLUME_HORIZON_HOURS,
} = {}) {
  const start = {
    lat: numValue(release?.lat),
    lon: numValue(release?.lon),
  };
  if (start.lat === null || start.lon === null) return null;
  const rows = Array.isArray(winds) ? winds : [];
  const hours = Math.max(0, Math.min(horizonHours, rows.length));
  const path = [
    {
      lat: start.lat,
      lon: start.lon,
      time: textValue(release?.time),
      hour: 0,
      distanceMi: 0,
      poolMi: 0,
      bearing: null,
      calm: false,
    },
  ];
  let lat = start.lat;
  let lon = start.lon;
  let distanceMi = 0;
  let poolMi = 0;
  let calmHours = 0;
  let stoppedEarly = false;
  for (let i = 0; i < hours; i += 1) {
    const wind = rows[i];
    const speed = numValue(wind?.speedMph);
    const bearing = downwindBearing(numValue(wind?.directionFrom));
    if (speed === null || bearing === null) {
      stoppedEarly = true;
      break;
    }
    if (speed === 0) {
      calmHours += 1;
      poolMi += PLUME_CALM_POOL_MI_PER_HOUR;
      path.push({
        lat,
        lon,
        time: textValue(wind?.time),
        hour: i + 1,
        distanceMi,
        poolMi,
        bearing,
        calm: true,
      });
      continue;
    }
    const next = destinationPoint({ lat, lon }, bearing, speed);
    lat = next.lat;
    lon = next.lon;
    distanceMi += speed;
    path.push({
      lat,
      lon,
      time: textValue(wind?.time),
      hour: i + 1,
      distanceMi,
      poolMi,
      bearing,
      calm: false,
    });
  }
  return {
    path,
    distanceMi,
    calmHours,
    stoppedEarly,
    windsUsed: path.length - 1,
  };
}

/**
 * Build the cone polygon ring ([lon, lat] pairs, GeoJSON order) from a
 * stepped path. At each node the half-width is
 * distanceMi × tan(15°) + poolMi; edge points sit perpendicular to the
 * local segment bearing (the release node uses the first wind's
 * bearing). The ring starts at the release point (the apex), runs out
 * the left edge, and returns down the right edge. A path of one node
 * (no winds stepped) yields a degenerate ring at the release point.
 */
export function buildConePolygon(
  path,
  halfAngleDeg = PLUME_CONE_HALF_ANGLE_DEG,
) {
  if (!Array.isArray(path) || path.length === 0) return null;
  const halfTan = Math.tan((halfAngleDeg * Math.PI) / 180);
  const firstBearing = path[1]?.bearing ?? path[0]?.bearing ?? 0;
  const left = [];
  const right = [];
  for (let i = 0; i < path.length; i += 1) {
    const node = path[i];
    const bearing = node.bearing ?? firstBearing;
    const halfWidth = node.distanceMi * halfTan + (node.poolMi ?? 0);
    const at = { lat: node.lat, lon: node.lon };
    left.push(destinationPoint(at, (bearing - 90 + 360) % 360, halfWidth));
    right.push(destinationPoint(at, (bearing + 90) % 360, halfWidth));
  }
  const ring = [{ lon: path[0].lon, lat: path[0].lat }];
  for (let i = 1; i < left.length; i += 1)
    ring.push({ lon: left[i].lon, lat: left[i].lat });
  for (let i = right.length - 1; i >= 1; i -= 1)
    ring.push({ lon: right[i].lon, lat: right[i].lat });
  return ring.map(({ lon, lat }) => [lon, lat]);
}

/**
 * The 10-mile EPZ reference circle as a closed [lon, lat] ring
 * (PLUME_EPZ_CIRCLE_POINTS vertices + the closing point).
 */
export function epzCircleRing({
  lat,
  lon,
  radiusMi = PLUME_EPZ_RADIUS_MI,
  points = PLUME_EPZ_CIRCLE_POINTS,
} = {}) {
  const centerLat = numValue(lat);
  const centerLon = numValue(lon);
  if (centerLat === null || centerLon === null) return null;
  const ring = [];
  for (let i = 0; i < points; i += 1) {
    const bearing = (i / points) * 360;
    const at = destinationPoint(
      { lat: centerLat, lon: centerLon },
      bearing,
      radiusMi,
    );
    ring.push([at.lon, at.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Build the full plume snapshot from fetched winds (pure). Returns the
 * snapshot or null when the release point is unusable. The snapshot
 * carries the winds stepped, the centroid path, the cone ring, the EPZ
 * ring, and the totals — everything the renderer and the analyst seam
 * need, with no further math at render time.
 */
export function buildPlumeSnapshot({
  fetchedAt,
  winds,
  release = PLUME_DEFAULT_RELEASE,
  horizonHours = PLUME_HORIZON_HOURS,
} = {}) {
  if (typeof fetchedAt !== 'number') return null;
  const stepped = stepPlume({ release, winds, horizonHours });
  if (!stepped) return null;
  const cone = buildConePolygon(stepped.path);
  const epz = epzCircleRing({ lat: release.lat, lon: release.lon });
  if (!cone || !epz) return null;
  return {
    fetchedAt,
    stale: false,
    release: {
      name: textValue(release?.name) ?? PLUME_DEFAULT_RELEASE.name,
      lat: numValue(release.lat),
      lon: numValue(release.lon),
      time: textValue(release?.time),
    },
    horizonHours,
    winds: Array.isArray(winds) ? winds.slice(0, stepped.windsUsed) : [],
    path: stepped.path,
    cone,
    epz,
    distanceMi: stepped.distanceMi,
    calmHours: stepped.calmHours,
    stoppedEarly: stepped.stoppedEarly,
    counts: {
      winds: stepped.windsUsed,
      nodes: stepped.path.length,
    },
  };
}

/** Validate a built plume snapshot (shape check for the source + tests). */
export function validatePlumeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    return null;
  if (typeof snapshot.fetchedAt !== 'number') return null;
  if (!Array.isArray(snapshot.winds) || !Array.isArray(snapshot.path))
    return null;
  if (!Array.isArray(snapshot.cone) || !Array.isArray(snapshot.epz))
    return null;
  if (!snapshot.release || typeof snapshot.release !== 'object') return null;
  if (
    !Number.isFinite(snapshot.release.lat) ||
    !Number.isFinite(snapshot.release.lon)
  )
    return null;
  return snapshot;
}
