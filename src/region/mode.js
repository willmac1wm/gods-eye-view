/**
 * Cape May regional mode for this fork.
 *
 * `GEV_REGION=cape` keeps catalogs, globe-reset, and voice "modes" on the
 * Cape May / South Jersey / Delaware overview. Unset, every helper below
 * preserves the upstream world defaults. `CCTV_REGION_PACKS` (comma-separated
 * pack names) overrides which CCTV packs load; it does not by itself move
 * the camera or the other world feeds.
 *
 * Military flights (`adsb.lol` `/v2/mil`) and OpenSky `states/all` have no
 * bbox parameter in this codebase. Regional mode does not invent one.
 */

/** Tri-state window shared with Cape Dispatch extras. West, south, east, north. */
export const CAPE_BBOX = Object.freeze({
  west: -76.2,
  south: 38.3,
  east: -73.8,
  north: 40.2,
});

/**
 * Stand-in for Reset Globe / zoom_to_globe when regional mode is on.
 * Height stays far under the app's global view band (>12,000 km).
 */
export const CAPE_OVERVIEW = Object.freeze({
  longitude: -75.0,
  latitude: 39.25,
  heightM: 220000,
  pitchDeg: -90,
  durationS: 2.2,
});

/** DelDOT plus FAA WeatherCams. Far packs stay off unless explicitly opted in. */
export const CAPE_CCTV_PACKS = Object.freeze(['deldot', 'faa-weathercams']);

/** Catalog cap used when regional CCTV is on and CCTV_MAX_SOURCES is unset. */
export const REGIONAL_CCTV_MAX_SOURCES = 500;

function browserConfig(key) {
  try {
    if (key === 'GEV_REGION') return import.meta.env.GEV_REGION;
    if (key === 'CCTV_REGION_PACKS') return import.meta.env.CCTV_REGION_PACKS;
  } catch {
    // Node unit tests have no import.meta.env. The server reads process.env.
  }
  return undefined;
}

/**
 * Operator env for a call. An explicit object wins so tests never mutate
 * process.env. Otherwise the server env wins, then the Vite define.
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>|undefined} env
 */
export function operatorEnv(env) {
  if (env) return env;
  const proc = typeof process !== 'undefined' && process.env ? process.env : {};
  const browserRegion = browserConfig('GEV_REGION') || '';
  const browserPacks = browserConfig('CCTV_REGION_PACKS') || '';
  // Server and unit tests have no Vite define. Don't copy process.env.
  if (!browserRegion && !browserPacks) return proc;
  return {
    ...proc,
    GEV_REGION: proc.GEV_REGION || browserRegion,
    CCTV_REGION_PACKS: proc.CCTV_REGION_PACKS || browserPacks,
  };
}

/** @param {Record<string, string|undefined>|undefined} [env] */
export function isCapeRegion(env) {
  return String(operatorEnv(env).GEV_REGION || '').trim().toLowerCase() === 'cape';
}

/**
 * CCTV packs allowed to load by default, or null when the world catalog
 * (each pack's own flag) is in effect.
 * @param {Record<string, string|undefined>|undefined} [env]
 * @returns {string[]|null}
 */
export function cctvAllowlist(env) {
  const source = operatorEnv(env);
  const raw = String(source.CCTV_REGION_PACKS || '').trim();
  if (raw) {
    return raw
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
  }
  if (isCapeRegion(source)) return [...CAPE_CCTV_PACKS];
  return null;
}

/**
 * Whether one live CCTV pack should fetch.
 * Outside an allowlist, `optIn` packs stay off until the flag is `1` and
 * every other pack stays on until the flag is `0` (Austin and Caltrans
 * included). Inside an allowlist, listed packs stay on until `0`; unlisted
 * packs stay off unless the flag is explicitly `1`.
 * @param {string} packName
 * @param {string} envName
 * @param {{optIn?: boolean}} [options]
 * @param {Record<string, string|undefined>|undefined} [env]
 */
export function cctvPackEnabled(packName, envName, options = {}, env) {
  const source = operatorEnv(env);
  const flag = String(source[envName] ?? '').trim();
  const allow = cctvAllowlist(source);
  if (allow) {
    const listed = allow.includes(String(packName).toLowerCase());
    if (!listed) return flag === '1';
    return flag !== '0';
  }
  if (options.optIn) return flag === '1';
  return flag !== '0';
}

/**
 * Value to feed resolveCatalogCap. Regional mode with no explicit
 * CCTV_MAX_SOURCES uses REGIONAL_CCTV_MAX_SOURCES.
 * @param {Record<string, string|undefined>|undefined} [env]
 */
export function effectiveCctvMaxSources(env) {
  const source = operatorEnv(env);
  const raw = source.CCTV_MAX_SOURCES;
  const explicit = raw != null && String(raw).trim() !== '';
  if (!explicit && cctvAllowlist(source)) return String(REGIONAL_CCTV_MAX_SOURCES);
  return raw;
}

/** FIRMS area path segment: `world`, or west,south,east,north. */
export function firmsArea(env) {
  if (!isCapeRegion(env)) return 'world';
  const box = CAPE_BBOX;
  return `${box.west},${box.south},${box.east},${box.north}`;
}

/** USGS feed. Regional mode asks FDSN for the tri-state window only. */
export function usgsEarthquakeFeedUrl(env, now = Date.now()) {
  if (!isCapeRegion(env)) {
    return 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
  }
  const start = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const box = CAPE_BBOX;
  const query = new URLSearchParams({
    format: 'geojson',
    starttime: start,
    minmagnitude: '2.5',
    minlatitude: String(box.south),
    maxlatitude: String(box.north),
    minlongitude: String(box.west),
    maxlongitude: String(box.east),
    orderby: 'time',
  });
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${query}`;
}

/** @param {number} lat @param {number} lon */
export function pointInCapeRegion(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const box = CAPE_BBOX;
  return (
    lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north
  );
}

/**
 * Transit feeds and bike-share systems. Unset region keeps every registered
 * system. Cape mode only polls ones whose center sits in the tri-state box.
 */
export function regionalSystemAllowed(lat, lon, env) {
  if (!isCapeRegion(env)) return true;
  return pointInCapeRegion(lat, lon);
}

/** Space Missions satellite catalog. Cape mode does not auto-fetch Starlink. */
export function spaceMissionsSatelliteCatalog(env) {
  return isCapeRegion(env) ? 'core' : 'dense';
}

/** First-run environmental tile. Cape mode does not enable world FIRMS. */
export function regionalMissionLayerIds(layerIds, env) {
  const ids = Array.isArray(layerIds) ? layerIds : [];
  if (!isCapeRegion(env)) return ids;
  return ids.filter((id) => id !== 'local-firms');
}
