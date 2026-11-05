import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import {
  clampInt,
  requiredFiniteQueryNumber,
} from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

const HYDRANT_LAYER =
  'https://services6.arcgis.com/uC0mne2MlQubT7ew/arcgis/rest/services/Cape_May_County_Fire_Hydrants/FeatureServer/0/query';

const MIB = 1024 * 1024;
const CACHE_TTL_MS = 15 * 60_000;
const STALE_MAX_MS = 24 * 60 * 60_000;

function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function metersToDeg(lat, meters) {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180) || 1e-6);
  return { dLat, dLon };
}

function mapFeature(feature, lat, lon) {
  const attrs = feature?.attributes || {};
  const x = feature?.geometry?.x;
  const y = feature?.geometry?.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const distanceM =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? Math.round(haversineM(lat, lon, y, x))
      : null;
  return {
    id: attrs.OBJECTID ?? null,
    number: attrs.NUMBER ?? null,
    type: String(attrs.TYPE || '').trim() || null,
    municipality: String(attrs.MUNIC || '').trim() || null,
    color: String(attrs.COLOR || '').trim() || null,
    lat: y,
    lon: x,
    distanceM,
  };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createHydrantsHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function upstream(lat, lon, radiusM, limit) {
    const { dLat, dLon } = metersToDeg(lat, radiusM);
    const envelope = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
    const url =
      `${HYDRANT_LAYER}?` +
      new URLSearchParams({
        geometry: envelope,
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,NUMBER,TYPE,MUNIC,COLOR',
        returnGeometry: 'true',
        outSR: '4326',
        resultRecordCount: String(Math.min(500, Math.max(limit * 4, 80))),
        f: 'json',
      }).toString();
    const signal = AbortSignal.timeout(25_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error('hydrant_upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(response, 4 * MIB, signal);
    const mapped = (payload?.features || [])
      .map((f) => mapFeature(f, lat, lon))
      .filter(Boolean)
      .filter((h) => h.distanceM == null || h.distanceM <= radiusM)
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
    const hydrants = mapped.slice(0, limit);
    return {
      lat,
      lon,
      radiusM,
      count: hydrants.length,
      nearest: hydrants[0] || null,
      hydrants,
      source: 'cape-may-county-hydrants',
    };
  }

  return async function hydrantsHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const url = new URL(req.url || '/', 'http://local');
    const lat = requiredFiniteQueryNumber(url.searchParams, 'lat');
    const lon = requiredFiniteQueryNumber(url.searchParams, 'lon');
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return json(res, 400, { error: 'lat_lon_required' });
    }
    const radiusM = clampInt(url.searchParams.get('radius_m'), 50, 5000, 800);
    const limit = clampInt(url.searchParams.get('limit'), 1, 100, 40);
    const key = `${lat.toFixed(5)},${lon.toFixed(5)},${radiusM},${limit}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.exp > t) {
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, hit.body);
    }
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, () =>
        upstream(lat, lon, radiusM, limit),
      );
      const body = await promise;
      cache.set(key, { exp: t + CACHE_TTL_MS, body, at: t });
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, body);
    } catch (error) {
      if (hit && t - hit.at < STALE_MAX_MS) {
        return json(res, 200, { ...hit.body, stale: true });
      }
      return json(res, 502, {
        error: 'hydrants_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
