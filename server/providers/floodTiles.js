// Predicted coastal-flooding raster tiles — port of old app/flood_map.py.
//
// How it works (same model, native upstreams):
//   1. Each tidal gauge has a forecast peak in feet above its MLLW zero
//      and an MHHW offset; peak - offset = water above a normal high tide.
//      Peaks below the minor flood stage produce no level, as before.
//   2. NOAA's Sea Level Rise Viewer publishes, for 0-10 ft above MHHW in
//      half-foot steps, which ground is connected to the water at that
//      level (coast.noaa.gov dc_slr/slr_*ft, tiled web-mercator PNGs,
//      public, no key).
//   3. For each map tile we take the level from the nearest gauge, fetch
//      NOAA's tile for that level and the 0 ft tile, and keep only pixels
//      that are water at the level but dry at 0 ft. Results are cached
//      in memory per level/tile (the SLR data is static).
//
// Differences from the old app: the level is county-wide per nearest
// gauge (same rule), but gauges come from the native flood payload
// (NWPS ACYN4 forecast + CO-OPS 8536110 next high tide) instead of the
// old app's 14-gauge NWS set; tiles are cached in memory, not on disk.
// A tile that cannot be built is transparent, never an error — a failed
// tile must not break the map. This is NOAA's planning-grade bathtub
// model (no wave run-up, drainage or levee failure).
import { fetchNativeFloodPayload } from './ops/floodNative.js';
import { decodePng, encodePng, diffFloodTiles } from './common/png.js';

const NOAA =
  'https://www.coast.noaa.gov/arcgis/rest/services/dc_slr/{svc}/MapServer/tile/{z}/{y}/{x}';
const MIN_Z = 10;
const MAX_Z = 16;
// Three-county box; tiles outside it are always transparent.
const BBOX = [38.85, -75.45, 39.75, -74.3]; // south, west, north, east
const MAX_LEVEL = 10.0;
const ANCHOR_RADIUS_KM = 40.0;
const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;
const TILE_TIMEOUT_MS = 15_000;
const TILE_SIZE = 256;

let _emptyPng = null;
export function emptyTilePng() {
  if (!_emptyPng) {
    _emptyPng = encodePng({
      width: TILE_SIZE,
      height: TILE_SIZE,
      data: Buffer.alloc(TILE_SIZE * TILE_SIZE * 4),
    });
  }
  return _emptyPng;
}

export function serviceForLevel(level) {
  if (level <= 0) return 'slr_0ft';
  const whole = Math.floor(level);
  const half = level - whole >= 0.5;
  return half ? `slr_${whole}_5ft` : `slr_${whole}ft`;
}

/** Nearest half foot, clamped to NOAA's 0-10 ft range. */
export function roundLevel(ftAboveMhhw) {
  if (ftAboveMhhw == null || !Number.isFinite(ftAboveMhhw)) return 0;
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(ftAboveMhhw * 2) / 2));
}

export function tileCenter(z, x, y) {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return [lat, lng];
}

function kmBetween(a, b) {
  const dlat = (a[0] - b[0]) * 111.32;
  const dlng = (a[1] - b[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dlat, dlng);
}

/**
 * Flood level (ft above MHHW) for a tile from the native flood payload.
 * One anchor per gauge: the forecast peak (NWPS forecast / CO-OPS next
 * high tide) minus MHHW, gated on the minor flood stage — exactly the
 * old anchors() rule, with the native gauge set.
 */
export function levelForTile(gauges, z, x, y) {
  const center = tileCenter(z, x, y);
  const [south, west, north, east] = BBOX;
  if (!(
    south <= center[0] &&
    center[0] <= north &&
    west <= center[1] &&
    center[1] <= east
  )) {
    return 0;
  }
  let best = null;
  for (const gauge of gauges || []) {
    if (gauge?.mhhw_ft == null || gauge?.forecast_ft == null) continue;
    const minor = gauge.minor_stage_ft;
    if (minor != null && gauge.forecast_ft < minor) continue;
    const above = gauge.forecast_ft - gauge.mhhw_ft;
    const level = roundLevel(above);
    if (level <= 0) continue;
    const distance = kmBetween(center, [gauge.lat, gauge.lon]);
    if (distance <= ANCHOR_RADIUS_KM && (best == null || distance < best[0])) {
      best = [distance, level];
    }
  }
  return best ? best[1] : 0;
}

async function fetchNoaaTile(fetchImpl, svc, z, x, y, cache) {
  const key = `${svc}/${z}/${y}/${x}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = NOAA.replace('{svc}', svc)
    .replace('{z}', String(z))
    .replace('{y}', String(y))
    .replace('{x}', String(x));
  const signal = AbortSignal.timeout(TILE_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal,
    headers: { Accept: 'image/png' },
  });
  if (!response.ok) {
    if (response.status === 404) {
      cache.set(key, null);
      if (cache.size > MAX_CACHE_ENTRIES)
        cache.delete(cache.keys().next().value);
      return null;
    }
    throw new Error(`noaa_tile_${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const decoded = decodePng(buffer);
  cache.set(key, decoded);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return decoded;
}

export async function buildFloodTile({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  z,
  x,
  y,
  payloadCache,
  tileCache,
} = {}) {
  if (
    !Number.isInteger(z) ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    z < MIN_Z ||
    z > MAX_Z
  ) {
    return emptyTilePng();
  }
  const nowMs = now();
  let payload = payloadCache?.payload;
  if (!payload || nowMs - (payloadCache?.at || 0) >= CACHE_MS) {
    payload = await fetchNativeFloodPayload({ fetchImpl, now }).catch(
      () => null,
    );
    if (payloadCache) {
      payloadCache.payload = payload;
      payloadCache.at = nowMs;
    }
  }
  const level = levelForTile(payload?.gauges, z, x, y);
  if (level <= 0) return emptyTilePng();
  const cache = tileCache || new Map();
  const [levelTile, baseTile] = await Promise.all([
    fetchNoaaTile(fetchImpl, serviceForLevel(level), z, x, y, cache),
    fetchNoaaTile(fetchImpl, 'slr_0ft', z, x, y, cache),
  ]);
  if (!levelTile) return emptyTilePng();
  const diffed = diffFloodTiles(levelTile, baseTile);
  if (!diffed) return emptyTilePng();
  return encodePng(diffed);
}

export function floodTilesProxy(options = {}) {
  const payloadCache = {};
  const tileCache = new Map();
  // Shared by the dev and preview hooks (the repo pattern — Vite invokes
  // the hooks unbound, so `this` delegation breaks in preview).
  function install(server) {
    server.middlewares.use('/api/flood-tiles', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'method_not_allowed' }));
      }
      const match = /^\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(
        String(req.url || '').split('?')[0],
      );
      if (!match) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'flood_tile_not_found' }));
      }
      try {
        const png = await buildFloodTile({
          ...options,
          z: Number(match[1]),
          x: Number(match[2]),
          y: Number(match[3]),
          payloadCache,
          tileCache,
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.end(png);
      } catch {
        // A tile that cannot be built is transparent, never an error.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.end(emptyTilePng());
      }
    });
  }
  return {
    name: 'flood-tiles',
    configureServer: install,
    configurePreviewServer: install,
  };
}
