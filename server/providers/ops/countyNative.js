// Native county status for the status strip County line and the board
// desk county panel. Port of the old app's app/county_status.py
// aggregation, rebuilt from the native sources that already exist:
//
//   - tide:   native NWPS floodwatch (/api/ops/flood payload)
//   - power:  native outages rollup (Cape May county)
//   - rip current: NWS Surf Zone Forecast (Mount Holly office, Atlantic
//     Coastal Cape May zone NJZ024) — same SRF product the old site
//     parsed
//   - call counts: Fire Wire /api/incidents (non-sensitive, last 24 h /
//     1 h) — the old counts came from the same incidents via official.py
//
// Payload keeps the fields the strip and board desk already read:
// { calls_1h, calls_24h, tide: { level_ft, category, flooding_now },
//   rip_current: { risk, surf, day, issued, error },
//   power: { county: { out, served } } }.
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { readResponseJsonCapped } from '../common/http.js';
import { fetchNativeFloodPayload } from './floodNative.js';
import { fetchNativeOutages } from './outagesNative.js';
import { fetchFireWireIncidents } from '../firewireCad.js';

const SRF_ZONE = 'NJZ024'; // Atlantic Coastal Cape May
const NWS_PRODUCTS = 'https://api.weather.gov/products/types/SRF/locations/PHI';
const NWS_UA = 'CapeDispatch/1.0 (capemaydispatch.com)';
const CACHE_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** First forecast day for a zone: rip current risk and surf height. */
export function parseSurfZoneForecast(text, zone = SRF_ZONE) {
  const body = String(text || '');
  const start = body.indexOf(zone);
  if (start < 0) return null;
  const block = body.slice(start).split('$$', 1)[0];
  const day = /^\.([A-Z][A-Z ]+)\.\.\./m.exec(block);
  const risk = /Rip Current Risk\.*\s*([A-Za-z]+)/.exec(block);
  const surf = /Surf Height\.*\s*([^\n]+?)\.?\s*$/m.exec(block);
  if (!risk) return null;
  return {
    risk: risk[1].charAt(0).toUpperCase() + risk[1].slice(1).toLowerCase(),
    surf: surf ? surf[1].trim() : null,
    day: day
      ? day[1].charAt(0).toUpperCase() + day[1].slice(1).toLowerCase()
      : null,
  };
}

export function countRecentCalls(incidents, nowMs) {
  let calls24h = 0;
  let calls1h = 0;
  for (const incident of incidents || []) {
    const at = Date.parse(incident?.timestamp || incident?.time || '');
    if (!Number.isFinite(at)) continue;
    const ageH = (nowMs - at) / 3600000;
    if (ageH >= 0 && ageH <= 24) calls24h += 1;
    if (ageH >= 0 && ageH <= 1) calls1h += 1;
  }
  return { calls_1h: calls1h, calls_24h: calls24h };
}

export async function buildNativeCountyStatus({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const [flood, outages, incidents, srf] = await Promise.all([
    fetchNativeFloodPayload({ fetchImpl, now }).catch(() => null),
    fetchNativeOutages({ fetchImpl, now }).catch(() => null),
    fetchFireWireIncidents({ fetchImpl, limit: 100 }).catch(() => ({
      configured: false,
      incidents: [],
    })),
    (async () => {
      try {
        const signal = AbortSignal.timeout(TIMEOUT_MS);
        const listResponse = await fetchImpl(NWS_PRODUCTS, {
          signal,
          headers: { Accept: 'application/geo+json', 'User-Agent': NWS_UA },
        });
        if (!listResponse.ok)
          return {
            risk: null,
            surf: null,
            day: null,
            issued: null,
            error: `srf_list_${listResponse.status}`,
          };
        const list = await readResponseJsonCapped(
          listResponse,
          MAX_RESPONSE_BYTES,
          signal,
        );
        const graph = list?.['@graph'] || [];
        if (!graph.length) {
          return {
            risk: null,
            surf: null,
            day: null,
            issued: null,
            error: 'no surf forecast issued (off season)',
          };
        }
        const productResponse = await fetchImpl(
          `https://api.weather.gov/products/${graph[0].id}`,
          {
            signal,
            headers: { Accept: 'application/geo+json', 'User-Agent': NWS_UA },
          },
        );
        if (!productResponse.ok)
          return {
            risk: null,
            surf: null,
            day: null,
            issued: null,
            error: `srf_product_${productResponse.status}`,
          };
        const product = await readResponseJsonCapped(
          productResponse,
          MAX_RESPONSE_BYTES,
          signal,
        );
        const parsed = parseSurfZoneForecast(product?.productText || '');
        if (!parsed) {
          return {
            risk: null,
            surf: null,
            day: null,
            issued: product?.issuanceTime || null,
            error: 'zone not in the latest forecast',
          };
        }
        return {
          ...parsed,
          issued: product?.issuanceTime || null,
          error: null,
        };
      } catch (error) {
        return {
          risk: null,
          surf: null,
          day: null,
          issued: null,
          error: String(error?.message || error),
        };
      }
    })(),
  ]);

  const watch = flood?.floodwatch || null;
  const capeMay = outages?.counties?.['Cape May'] || { out: 0, served: 0 };
  const counts = countRecentCalls(incidents?.incidents || [], now());
  return {
    ...counts,
    tide: watch
      ? {
          level_ft: watch.level_ft,
          category: watch.category,
          flooding_now: watch.flooding_now,
          observed_at: watch.fetched_at || null,
        }
      : { level_ft: null, category: null, flooding_now: false },
    rip_current: srf,
    power: { county: { out: capeMay.out || 0, served: capeMay.served || 0 } },
    source: 'native',
    fetched_at: new Date(now()).toISOString(),
  };
}

export function createCountyNativeHandler(options = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });
  let cache = null;
  let cacheAt = 0;

  return async function countyHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req))) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'rate_limited' }));
    }
    try {
      const t = Date.now();
      if (!cache || t - cacheAt >= CACHE_MS) {
        cache = await buildNativeCountyStatus(options);
        cacheAt = t;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.end(JSON.stringify(cache));
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'native_county_failed',
          detail: String(error?.message || error),
        }),
      );
    }
  };
}
