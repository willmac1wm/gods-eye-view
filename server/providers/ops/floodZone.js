import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  isRetiredCapeWebsite,
  resolveCapeUpstream,
} from '../capeUpstream.js';

// NJDEP Hydrography hosts the NFHL polygons for New Jersey (Cape May).
const NJ_NFHL_QUERY =
  'https://mapsdep.nj.gov/arcgis/rest/services/Features/Hydrography/MapServer/43/query';
const MIB = 1024 * 1024;
const CACHE_TTL_MS = 30 * 60_000;
const SFHA_ZONES = new Set([
  'A',
  'AE',
  'AH',
  'AO',
  'AR',
  'A99',
  'V',
  'VE',
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function mapNfhl(attrs) {
  if (!attrs) return null;
  const zone = attrs.FLD_ZONE || null;
  return {
    zone,
    subtype: attrs.ZONE_SUBTY || null,
    sfha:
      attrs.SFHA_TF === 'T' ||
      attrs.SFHA_TF === true ||
      (zone ? SFHA_ZONES.has(String(zone).toUpperCase()) : false),
    staticBfe: attrs.STATIC_BFE ?? null,
    source: 'njdep-nfhl',
  };
}

export function createFloodZoneHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  resolveUpstream = resolveCapeUpstream,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function fromFirewire(lat, lon) {
    const base = resolveUpstream();
    if (!base || isRetiredCapeWebsite(base)) return null;
    const url = new URL('/api/tools/flood-zone', `${base}/`);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    const signal = AbortSignal.timeout(15_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel?.();
      return null;
    }
    const payload = await readResponseJsonCapped(response, MIB, signal);
    return {
      lat,
      lon,
      zone: payload.zone || payload.fld_zone || payload.flood_zone || null,
      subtype: payload.subtype || payload.zone_subty || null,
      sfha: Boolean(payload.sfha ?? payload.in_sfha),
      detail: payload,
      source: 'firewire-flood-zone',
    };
  }

  async function fromNjNfhl(lat, lon) {
    const url =
      `${NJ_NFHL_QUERY}?` +
      new URLSearchParams({
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'FLD_ZONE,ZONE_SUBTY',
        returnGeometry: 'false',
        f: 'json',
      }).toString();
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error('nj_nfhl_unavailable');
    }
    const payload = await readResponseJsonCapped(response, MIB, signal);
    const attrs = payload?.features?.[0]?.attributes || null;
    return {
      lat,
      lon,
      ...mapNfhl(attrs),
      found: Boolean(attrs),
    };
  }

  async function upstream(lat, lon) {
    try {
      const fw = await fromFirewire(lat, lon);
      if (fw?.zone) return { ...fw, found: true };
    } catch {
      /* fall through to NJ NFHL */
    }
    return fromNjNfhl(lat, lon);
  }

  return async function floodZoneHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    const url = new URL(req.url || '/', 'http://local');
    const lat = requiredFiniteQueryNumber(url.searchParams, 'lat');
    const lon = requiredFiniteQueryNumber(url.searchParams, 'lon');
    if (lat == null || lon == null) {
      return json(res, 400, { error: 'lat_lon_required' });
    }
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.exp > t) return json(res, 200, hit.body);
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, () =>
        upstream(lat, lon),
      );
      const body = await promise;
      cache.set(key, { exp: t + CACHE_TTL_MS, body });
      return json(res, 200, body);
    } catch (error) {
      return json(res, 502, {
        error: 'flood_zone_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
