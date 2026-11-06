/**
 * Native Cape floodwatch / gauges — NOAA NWPS / water.weather.gov style feeds.
 * Prefer these over Fire Wire flood_* when available.
 */

import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/** Primary Cape May / South Jersey gauges. */
export const CAPE_FLOOD_GAUGES = Object.freeze([
  Object.freeze({
    id: 'cmhn4',
    name: 'Cape May Harbor',
    lat: 38.9483,
    lon: -74.8897,
    link: 'https://water.noaa.gov/gauges/cmhn4',
  }),
  Object.freeze({
    id: 'acyn4',
    name: 'Atlantic City',
    lat: 39.3567,
    lon: -74.4183,
    link: 'https://water.noaa.gov/gauges/acyn4',
  }),
  Object.freeze({
    id: 'brnn4',
    name: 'Brandywine Shoal Light',
    lat: 38.9867,
    lon: -75.1133,
    link: 'https://water.noaa.gov/gauges/brnn4',
  }),
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(JSON.stringify(body));
}

function categoryFromStage(obs, floodStage) {
  if (obs == null || floodStage == null) return 'unknown';
  if (obs < floodStage) return 'no_flooding';
  if (obs < floodStage + 1) return 'action';
  if (obs < floodStage + 2) return 'minor';
  if (obs < floodStage + 3) return 'moderate';
  return 'major';
}

/**
 * Fetch NWPS gauge JSON when available; fall back to catalog with null levels.
 */
export async function fetchNativeFloodPayload({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
} = {}) {
  const gauges = [];
  for (const g of CAPE_FLOOD_GAUGES) {
    let level_ft = null;
    let category = 'unknown';
    let trend_ft_per_hr = null;
    try {
      // NOAA water gauge observed data (public JSON). Fail soft per gauge.
      const url = `https://api.water.noaa.gov/nwps/v1/gauges/${g.id}`;
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        const status = data?.status || data?.observed || {};
        const primary = status?.primary || status?.obs || {};
        level_ft =
          primary?.value != null
            ? Number(primary.value)
            : status?.stage != null
              ? Number(status.stage)
              : null;
        const flood =
          data?.flood?.stage != null
            ? Number(data.flood.stage)
            : data?.floodStage != null
              ? Number(data.floodStage)
              : null;
        category = categoryFromStage(level_ft, flood);
        if (status?.secondary?.value != null) {
          trend_ft_per_hr = Number(status.secondary.value);
        }
      }
    } catch {
      /* soft */
    }
    gauges.push({
      id: g.id,
      name: g.name,
      lat: g.lat,
      lon: g.lon,
      level_ft,
      category,
      trend_ft_per_hr,
      link: g.link,
      source: 'native-nwps',
      observed: {
        category,
        value: level_ft,
        unit: 'ft',
      },
    });
  }

  const primary =
    gauges.find((g) => g.id === 'cmhn4') || gauges[0] || null;
  const watch = primary
    ? {
        station_name: primary.name,
        station_id: primary.id,
        level_ft: primary.level_ft,
        category: primary.category,
        flooding_now: /minor|moderate|major|action/i.test(
          String(primary.category || ''),
        ),
        trend_ft_per_hr: primary.trend_ft_per_hr,
        source: 'native-nwps',
        fetched_at: new Date(now()).toISOString(),
      }
    : null;

  return {
    floodwatch: watch,
    gauges,
    storms: [],
    plan: {
      flooding: Boolean(watch?.flooding_now),
      max_level: primary?.level_ft ?? 0,
      source: 'native',
    },
    source: 'native',
  };
}

export function createFloodNativeHandlers(options = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });
  let cache = null;
  let cacheAt = 0;

  async function getPayload() {
    if (cache && Date.now() - cacheAt < 60_000) return cache;
    cache = await fetchNativeFloodPayload(options);
    cacheAt = Date.now();
    return cache;
  }

  async function handler(req, res, kind) {
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
      const payload = await getPayload();
      if (kind === 'watch') json(res, 200, payload.floodwatch);
      else if (kind === 'gauges') json(res, 200, { gauges: payload.gauges });
      else if (kind === 'plan') json(res, 200, payload.plan);
      else json(res, 200, payload);
    } catch (error) {
      json(res, 502, {
        error: 'native_flood_failed',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    watchHandler: (req, res) => handler(req, res, 'watch'),
    gaugesHandler: (req, res) => handler(req, res, 'gauges'),
    planHandler: (req, res) => handler(req, res, 'plan'),
    allHandler: (req, res) => handler(req, res, 'all'),
    getPayload,
  };
}
