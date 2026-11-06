/**
 * GEV board aggregator — native NWS + flood + outages + optional messages/news.
 * Fire Wire GET /board remains an optional client-side fallback.
 */

import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { fetchNativeFloodPayload } from './floodNative.js';
import { fetchNativeOutages } from './outagesNative.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.end(JSON.stringify(body));
}

async function fetchNwsAlerts({
  fetchImpl = globalThis.fetch.bind(globalThis),
} = {}) {
  try {
    const url =
      'https://api.weather.gov/alerts/active?area=NJ&limit=20';
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'GodsEyeView-CapeOps/1.0 (board aggregator)',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return features.slice(0, 12).map((f) => {
      const p = f.properties || {};
      return {
        id: p.id || f.id,
        event: p.event,
        headline: p.headline,
        severity: p.severity,
        area: p.areaDesc,
      };
    });
  } catch {
    return [];
  }
}

export async function buildNativeBoard({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  getMessages = async () => [],
} = {}) {
  const [flood, outages, nws, messages] = await Promise.all([
    fetchNativeFloodPayload({ fetchImpl, now }),
    fetchNativeOutages({ fetchImpl, now }),
    fetchNwsAlerts({ fetchImpl }),
    getMessages().catch(() => []),
  ]);

  const official = [];
  if (flood?.floodwatch) {
    const w = flood.floodwatch;
    official.push({
      id: 'tide',
      kind: 'weather',
      label: `${w.station_name}: ${w.level_ft ?? '—'} ft (${w.category || '—'})`,
      tone: w.flooding_now ? 'warn' : 'ok',
      source: 'native-flood',
    });
  }
  for (const alert of nws.slice(0, 5)) {
    official.push({
      id: `nws-${alert.id || alert.event}`,
      kind: 'nws',
      label: alert.headline || alert.event || 'NWS alert',
      tone: /extreme|severe/i.test(alert.severity || '') ? 'warn' : 'info',
      source: 'native-nws',
    });
  }
  if (outages) {
    const total = Number(outages.customers_affected) || 0;
    official.push({
      id: 'power',
      kind: 'power',
      label:
        total > 0
          ? `Power outages · ${total} customers`
          : 'Power · no county outages reported',
      tone: total > 0 ? 'warn' : 'ok',
      source: outages.source,
    });
  }

  const flash_rumors = (Array.isArray(messages) ? messages : [])
    .slice(0, 10)
    .map((m) => ({
      id: m.id,
      text: m.text || m.body,
      at: m.createdAt || m.at,
      source: 'ops-messages',
    }));

  return {
    official,
    flash_rumors,
    news: flash_rumors,
    wire: [],
    outages,
    floodwatch: flood?.floodwatch || null,
    source: 'native',
    fetched_at: new Date(now()).toISOString(),
  };
}

export function createBoardNativeHandler(options = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });
  let cache = null;
  let cacheAt = 0;

  return async function boardHandler(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!allow(clientKey(req))) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }
    try {
      if (!cache || Date.now() - cacheAt > 30_000) {
        cache = await buildNativeBoard(options);
        cacheAt = Date.now();
      }
      json(res, 200, cache);
    } catch (error) {
      json(res, 502, {
        error: 'native_board_failed',
        detail: String(error?.message || error),
      });
    }
  };
}
