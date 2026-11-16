// Native NWS alerts for the cape-nws layer — api.weather.gov, keyless.
// Replaces the old app's /api/hazards + /api/feeds for this layer: the
// alerts come from the same source the old site used (NWS Mount Holly,
// Cape May County zones NJZ023 + NJZ024), but the new app fetches them
// directly instead of through the retired Python backend.
//
// The payload keeps the shape src/layers/capeDispatch/model.js mapNws()
// already consumes: { nws_alerts: [{ id, event, headline, area, severity,
// geometry }], feeds: {} }. geometry is the NWS GeoJSON Polygon /
// MultiPolygon (or null — zone alerts often carry no geometry, and mapNws
// skips those, exactly as it did with the old upstream). The old feeds
// half (Waze / USGS / NJ511 pins from /api/feeds) has no direct public
// equivalent in this provider and is dropped with the old backend.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const NWS_ZONES = 'NJZ023,NJZ024';
const NWS_URL = `https://api.weather.gov/alerts/active?zone=${NWS_ZONES}`;
const CACHE_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** NWS alert features -> the mapNws() alert shape (GeoJSON geometry kept). */
export function normalizeNwsAlerts(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const alerts = [];
  for (const feature of features) {
    const p = feature?.properties || {};
    if (!p.event) continue;
    alerts.push({
      id: p.id || feature.id || null,
      event: p.event,
      headline: p.headline || '',
      area: p.areaDesc || '',
      severity: p.severity || '',
      geometry: feature.geometry || null,
    });
  }
  return alerts;
}

export function nwsAlertsUrl() {
  return NWS_URL;
}

export function nwsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load() {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(NWS_URL, {
      signal,
      redirect: 'error',
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'GodsEyeView-CapeNWS/1.0 (cape-dispatch)',
      },
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(`nws_upstream_${response.status}`);
    }
    const payload = await readResponseJsonCapped(
      response,
      MAX_RESPONSE_BYTES,
      signal,
    );
    return {
      nws_alerts: normalizeNwsAlerts(payload),
      feeds: {},
      source: 'api.weather.gov',
      zones: NWS_ZONES,
      updatedAt: new Date(now()).toISOString(),
    };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req)))
      return json(429, { error: 'rate_limited' });
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) return json(200, cache);
    try {
      if (!inflight) inflight = load().finally(() => {
        inflight = null;
      });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, cache);
    } catch (error) {
      if (cache) return json(200, { ...cache, stale: true });
      return json(502, {
        error: 'nws_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'nws-alerts',
    configureServer({ middlewares }) {
      middlewares.use('/api/nws', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/nws', handler);
    },
  };
}
