import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

const NARW_QUERY =
  'https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NMFS_North_Atlantic_right_whale__NARW__Areas/FeatureServer/9/query';

const MIB = 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60_000;

function ringCentroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let lon = 0;
  let lat = 0;
  let n = 0;
  for (const pt of ring) {
    const x = Array.isArray(pt) ? pt[0] : pt?.x;
    const y = Array.isArray(pt) ? pt[1] : pt?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lon += x;
    lat += y;
    n += 1;
  }
  if (!n) return null;
  return { lon: lon / n, lat: lat / n };
}

function simplifyRing(ring, maxPoints = 80) {
  if (!Array.isArray(ring) || ring.length <= maxPoints) return ring || [];
  const step = Math.ceil(ring.length / maxPoints);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const first = ring[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    out.push(first);
  }
  return out;
}

function mapFeature(feature, index) {
  const rings = feature?.geometry?.rings;
  const outer = Array.isArray(rings?.[0]) ? rings[0] : null;
  if (!outer) return null;
  const positions = simplifyRing(
    outer.map((pt) => [pt[0], pt[1]]),
    100,
  );
  const centroid = ringCentroid(positions);
  if (!centroid) return null;
  const attrs = feature.attributes || {};
  const title =
    attrs.NAME ||
    attrs.AREANAME ||
    attrs.ZONE ||
    attrs.SEASON ||
    `NARW area ${attrs.OBJECTID || index + 1}`;
  return {
    id: `narw-${attrs.OBJECTID || index}`,
    title: String(title),
    details: [
      'North Atlantic right whale management area',
      attrs.STATUS || attrs.TYPE || null,
    ].filter(Boolean),
    accent: '#38bdf8',
    kind: 'polygon',
    positions,
    lat: centroid.lat,
    lon: centroid.lon,
    alpha: 0.2,
    height: 0,
  };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createWhalesHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 300 });

  async function upstream() {
    const url =
      `${NARW_QUERY}?` +
      new URLSearchParams({
        where: '1=1',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'json',
      }).toString();
    const signal = AbortSignal.timeout(45_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error('narw_upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(response, 8 * MIB, signal);
    const zones = (payload?.features || [])
      .map((f, i) => mapFeature(f, i))
      .filter(Boolean);
    return {
      count: zones.length,
      zones,
      source: 'nmfs-narw-areas',
      updatedAt: new Date(now()).toISOString(),
    };
  }

  return async function whalesHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });
    const key = 'narw-all';
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.exp > t) return json(res, 200, hit.body);
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, () => upstream());
      const body = await promise;
      cache.set(key, { exp: t + CACHE_TTL_MS, body });
      return json(res, 200, body);
    } catch (error) {
      if (hit) return json(res, 200, { ...hit.body, stale: true });
      return json(res, 502, {
        error: 'whales_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
