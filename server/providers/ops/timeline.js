import { readResponseBytesCapped } from '../common/http.js';
import {
  clampInt,
  requiredFiniteQueryNumber,
} from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/** NJGIN Basemap orthophotos — coastal BW + natural color years. */
export const TIMELINE_ERAS = Object.freeze([
  {
    id: 'bw1920',
    label: 'Coastal B&W ~1920',
    service: 'Basemap/Coastal_BW_1920_WM',
  },
  {
    id: 'natural2012',
    label: 'Natural color 2012',
    service: 'Basemap/Orthos_Natural_2012_NJ_WM',
  },
  {
    id: 'natural2015',
    label: 'Natural color 2015',
    service: 'Basemap/Orthos_Natural_2015_NJ_WM',
  },
  {
    id: 'natural2020',
    label: 'Natural color 2020',
    service: 'Basemap/Orthos_Natural_2020_NJ_WM',
  },
]);

const ERA_BY_ID = new Map(TIMELINE_ERAS.map((e) => [e.id, e]));
const HALF_WINDOW_DEG = 0.00135; // ~150 m at mid-latitudes
const MIB = 1024 * 1024;
const CACHE_TTL_MS = 30 * 60_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function exportUrl(service, lat, lon, size) {
  const bbox = [
    lon - HALF_WINDOW_DEG,
    lat - HALF_WINDOW_DEG,
    lon + HALF_WINDOW_DEG,
    lat + HALF_WINDOW_DEG,
  ].join(',');
  return (
    `https://maps.nj.gov/arcgis/rest/services/${service}/MapServer/export?` +
    new URLSearchParams({
      bbox,
      bboxSR: '4326',
      imageSR: '3857',
      size: `${size},${size}`,
      format: 'jpg',
      f: 'image',
    }).toString()
  );
}

export function createTimelineHandlers({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 900 });

  async function erasHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (req.method === 'HEAD') {
      res.statusCode = 200;
      return res.end();
    }
    return json(res, 200, {
      eras: TIMELINE_ERAS.map(({ id, label }) => ({ id, label })),
      defaults: { then: 'bw1920', now: 'natural2020' },
      source: 'njgin-basemap',
    });
  }

  async function imageHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const url = new URL(req.url || '/', 'http://local');
    const eraId = String(url.searchParams.get('era') || '').trim();
    const era = ERA_BY_ID.get(eraId);
    const lat = requiredFiniteQueryNumber(url.searchParams, 'lat');
    const lon = requiredFiniteQueryNumber(url.searchParams, 'lon');
    const size = clampInt(url.searchParams.get('size'), 256, 1024, 640);
    if (!era || lat == null || lon == null) {
      return json(res, 400, { error: 'era_lat_lon_required' });
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return json(res, 400, { error: 'lat_lon_out_of_range' });
    }
    const key = `${eraId}:${lat.toFixed(5)},${lon.toFixed(5)}:${size}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.exp > t) {
      res.statusCode = 200;
      res.setHeader('Content-Type', hit.type);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('X-Ops-Era', eraId);
      return res.end(req.method === 'HEAD' ? undefined : hit.bytes);
    }
    try {
      const signal = AbortSignal.timeout(30_000);
      const response = await fetchImpl(exportUrl(era.service, lat, lon, size), {
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel?.();
        throw new Error(`upstream_${response.status}`);
      }
      const raw = await readResponseBytesCapped(response, 4 * MIB, signal);
      const type = response.headers.get('content-type') || 'image/jpeg';
      const bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      cache.set(key, { exp: t + CACHE_TTL_MS, bytes, type });
      // Bound memory: drop oldest when large.
      if (cache.size > 80) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('X-Ops-Era', eraId);
      return res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      return json(res, 502, {
        error: 'timeline_image_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return { erasHandler, imageHandler };
}
