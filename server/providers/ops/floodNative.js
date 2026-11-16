/**
 * Native Cape floodwatch / gauges — NOAA NWPS / water.weather.gov style feeds.
 * Prefer these over Fire Wire flood_* when available.
 *
 * Live payload shapes (verified 2026-11-16 — the previous parser read a
 * shape NWPS never returns, so every gauge came back null):
 *
 * NWPS v1 (api.water.noaa.gov/nwps/v1/gauges/{lid}):
 *   status: { observed: { primary: <ft MLLW, number>, floodCategory, validTime },
 *             forecast: { primary: <ft MLLW, number>, floodCategory, validTime } }
 *   flood:  { categories: { action|minor|moderate|major: { stage: <ft> } } }
 *   CMHN4 and BRNN4 are NOT in NWPS v1 (404 "could not find gauge ID"), so
 *   Cape May Harbor comes from NOAA CO-OPS station 8536110 instead
 *   (water_level + predictions hilo, datum MLLW, public, no key).
 *
 * MHHW offsets (CO-OPS datums API, 2026-11-16, feet above station datum):
 *   8536110 Cape May: MHHW 7.87 - MLLW 2.42 = 5.45 ft above MLLW.
 *   8534720 Atlantic City (ACYN4 proxy): MHHW 9.56 - MLLW 4.96 = 4.60 ft.
 * Re-check on a datum-epoch update; the values only feed the flood-tile
 * level (feet above MHHW), not the gauge readings themselves.
 */

import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/** Primary Cape May / South Jersey gauges. */
export const CAPE_FLOOD_GAUGES = Object.freeze([
  Object.freeze({
    id: 'cmhn4',
    name: 'Cape May Harbor',
    lat: 38.9683,
    lon: -74.96,
    link: 'https://tidesandcurrents.noaa.gov/stationhome.html?id=8536110',
    coopsStation: '8536110',
    mhhwFt: 5.45,
    minorStageFt: 6.2,
  }),
  Object.freeze({
    id: 'acyn4',
    name: 'Atlantic City',
    lat: 39.3567,
    lon: -74.4183,
    link: 'https://water.noaa.gov/gauges/acyn4',
    mhhwFt: 4.6,
  }),
  Object.freeze({
    id: 'brnn4',
    name: 'Brandywine Shoal Light',
    lat: 38.9867,
    lon: -75.1133,
    link: 'https://water.noaa.gov/gauges/brnn4',
    mhhwFt: null,
  }),
]);

const COOPS_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const COOPS_APP = 'CapeDispatch';
const NWPS_BASE = 'https://api.water.noaa.gov/nwps/v1/gauges';

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

function nwpsCategory(value) {
  const raw = String(value || '').toLowerCase();
  if (!raw || raw === 'no_flooding') return 'no_flooding';
  if (['action', 'minor', 'moderate', 'major'].includes(raw)) return raw;
  return 'unknown';
}

function fmtCoopsDate(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseCoopsTime(text) {
  // CO-OPS "YYYY-MM-DD HH:MM" is GMT per time_zone=gmt.
  const parsed = Date.parse(`${String(text || '').trim().replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** CO-OPS 8536110: latest level, 1 h trend, next high tide. Nulls on failure. */
async function fetchCoopsGauge(gauge, fetchImpl, nowMs) {
  const station = gauge.coopsStation;
  const end = fmtCoopsDate(nowMs);
  const start = fmtCoopsDate(nowMs - 2 * 3600 * 1000);
  const rangeUrl =
    `${COOPS_BASE}?product=water_level&station=${station}` +
    `&begin_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}` +
    `&datum=MLLW&units=english&time_zone=gmt&application=${COOPS_APP}&format=json`;
  const day = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}`;
  const tomorrow = fmtCoopsDate(nowMs + 24 * 3600 * 1000).slice(0, 8);
  const predUrl =
    `${COOPS_BASE}?product=predictions&station=${station}` +
    `&begin_date=${today}&end_date=${tomorrow}` +
    `&datum=MLLW&units=english&time_zone=gmt&interval=hilo&application=${COOPS_APP}&format=json`;
  const [rangeResponse, predResponse] = await Promise.all([
    fetchImpl(rangeUrl, { headers: { Accept: 'application/json' } }),
    fetchImpl(predUrl, { headers: { Accept: 'application/json' } }),
  ]);
  let levelFt = null;
  let trend = null;
  let observedTime = null;
  if (rangeResponse.ok) {
    const data = await rangeResponse.json();
    const rows = (Array.isArray(data?.data) ? data.data : [])
      .map((row) => ({
        at: parseCoopsTime(row?.t),
        value: row?.v != null ? Number(row.v) : null,
      }))
      .filter((row) => row.at != null && Number.isFinite(row.value))
      .sort((a, b) => a.at - b.at);
    const latest = rows[rows.length - 1];
    if (latest) {
      levelFt = latest.value;
      observedTime = new Date(latest.at).toISOString();
      const hourAgo = rows.reduce(
        (best, row) =>
          Math.abs(row.at - (nowMs - 3600 * 1000)) <
          Math.abs(best.at - (nowMs - 3600 * 1000))
            ? row
            : best,
        latest,
      );
      if (hourAgo !== latest) {
        const hours = (latest.at - hourAgo.at) / 3600000;
        if (hours > 0) trend = (latest.value - hourAgo.value) / hours;
      }
    }
  }
  let nextHigh = null;
  if (predResponse.ok) {
    const data = await predResponse.json();
    const highs = (Array.isArray(data?.predictions) ? data.predictions : [])
      .filter((row) => row?.type === 'H')
      .map((row) => ({
        at: parseCoopsTime(row?.t),
        value: row?.v != null ? Number(row.v) : null,
      }))
      .filter((row) => row.at != null && row.at > nowMs && Number.isFinite(row.value))
      .sort((a, b) => a.at - b.at);
    const next = highs[0];
    if (next) {
      nextHigh = {
        time: new Date(next.at).toISOString(),
        level_ft: next.value,
        category: categoryFromStage(next.value, gauge.minorStageFt),
      };
    }
  }
  return { levelFt, trend, observedTime, nextHigh };
}

/** NWPS v1 gauge: observed + forecast levels (feet MLLW) and flood stages. */
async function fetchNwpsGauge(gauge, fetchImpl) {
  const response = await fetchImpl(`${NWPS_BASE}/${gauge.id}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const observed = data?.status?.observed || {};
  const forecast = data?.status?.forecast || {};
  const stages = data?.flood?.categories || {};
  const minorStage =
    stages?.minor?.stage != null ? Number(stages.minor.stage) : null;
  const level =
    observed?.primary != null ? Number(observed.primary) : null;
  return {
    levelFt: Number.isFinite(level) ? level : null,
    trend: null,
    observedTime: observed?.validTime || null,
    category: nwpsCategory(observed?.floodCategory),
    forecastFt:
      forecast?.primary != null && Number.isFinite(Number(forecast.primary))
        ? Number(forecast.primary)
        : null,
    forecastTime: forecast?.validTime || null,
    forecastCategory: nwpsCategory(forecast?.floodCategory),
    minorStageFt: minorStage,
    nextHigh: null,
  };
}

async function fetchGauge(gauge, fetchImpl, nowMs) {
  const base = {
    id: gauge.id,
    name: gauge.name,
    lat: gauge.lat,
    lon: gauge.lon,
    level_ft: null,
    category: 'unknown',
    trend_ft_per_hr: null,
    link: gauge.link,
    source: gauge.coopsStation ? 'native-coops' : 'native-nwps',
    observed: { category: 'unknown', value: null, unit: 'ft', time: null },
    forecast: null,
    forecast_ft: null,
    forecast_category: null,
    mhhw_ft: gauge.mhhwFt ?? null,
    minor_stage_ft: gauge.minorStageFt ?? null,
    datum: 'MLLW',
  };
  try {
    const result = gauge.coopsStation
      ? await fetchCoopsGauge(gauge, fetchImpl, nowMs)
      : await fetchNwpsGauge(gauge, fetchImpl);
    if (!result) return base;
    const category = gauge.coopsStation
      ? categoryFromStage(result.levelFt, gauge.minorStageFt)
      : result.category;
    const forecastValue = gauge.coopsStation
      ? (result.nextHigh?.level_ft ?? null)
      : result.forecastFt;
    const forecastCategory = gauge.coopsStation
      ? (result.nextHigh?.category ?? null)
      : result.forecastCategory;
    return {
      ...base,
      level_ft: result.levelFt,
      category,
      trend_ft_per_hr: result.trend,
      observed: {
        category,
        value: result.levelFt,
        unit: 'ft',
        time: result.observedTime,
      },
      forecast:
        forecastValue != null
          ? {
              value: forecastValue,
              time: gauge.coopsStation
                ? (result.nextHigh?.time ?? null)
                : result.forecastTime,
              category: forecastCategory,
            }
          : null,
      forecast_ft: forecastValue,
      forecast_category: forecastCategory,
      minor_stage_ft:
        result.minorStageFt ?? gauge.minorStageFt ?? null,
      next_high_tide: result.nextHigh || null,
    };
  } catch {
    return base;
  }
}

/**
 * Fetch NWPS gauge JSON when available; fall back to catalog with null levels.
 */
export async function fetchNativeFloodPayload({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
} = {}) {
  const nowMs = now();
  const gauges = [];
  for (const g of CAPE_FLOOD_GAUGES) {
    gauges.push(await fetchGauge(g, fetchImpl, nowMs));
  }

  const primary = gauges.find((g) => g.id === 'cmhn4') || gauges[0] || null;
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
        source: primary.source,
        fetched_at: new Date(nowMs).toISOString(),
        next_high_tide: primary.next_high_tide || null,
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
    if (admitSameSiteKeyless(req, res)) return;
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
