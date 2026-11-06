/**
 * Proxy FAA VFR sectional / IFR low chart tiles (ArcGIS) for the ATC desk.
 * Keeps CORS and referrer issues off the browser.
 */

import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

const LAYERS = Object.freeze({
  vfr: 'https://tiles.arcgis.com/tiles/ssFJjBSIAS4TbFWT/arcgis/rest/services/VFR_Sectional/MapServer/tile',
  ifr_low:
    'https://tiles.arcgis.com/tiles/ssFJjBSIAS4TbFWT/arcgis/rest/services/IFR_Low_Enroute_US/MapServer/tile',
});

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createAtcChartsHandler({
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 240, globalMax: 2000 });

  return async function atcChartsHandler(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!allow(clientKey(req))) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }

    // /api/ops/atc/charts/:layer/:z/:y/:x
    const url = new URL(req.url || '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    // When mounted at /api/ops/atc/charts, path may be /vfr/7/48/37 or full.
    let layer;
    let z;
    let y;
    let x;
    const chartIdx = parts.indexOf('charts');
    if (chartIdx >= 0 && parts.length >= chartIdx + 5) {
      layer = parts[chartIdx + 1];
      z = parts[chartIdx + 2];
      y = parts[chartIdx + 3];
      x = parts[chartIdx + 4];
    } else if (parts.length >= 4) {
      layer = parts[0];
      z = parts[1];
      y = parts[2];
      x = parts[3];
    }

    const base = LAYERS[layer];
    if (!base) {
      json(res, 400, {
        error: 'unknown_layer',
        layers: Object.keys(LAYERS),
      });
      return;
    }
    if (!/^\d{1,2}$/.test(z) || !/^\d+$/.test(y) || !/^\d+$/.test(x)) {
      json(res, 400, { error: 'bad_tile' });
      return;
    }

    const upstream = `${base}/${z}/${y}/${x}`;
    try {
      const response = await fetchImpl(upstream, {
        headers: { Accept: 'image/*,*/*' },
      });
      if (!response.ok) {
        res.statusCode = response.status === 404 ? 404 : 502;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }
      const buf = Buffer.from(await response.arrayBuffer());
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        response.headers.get('content-type') || 'image/jpeg',
      );
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(buf);
    } catch {
      json(res, 502, { error: 'chart_upstream_failed' });
    }
  };
}

export { LAYERS as ATC_CHART_LAYERS };
