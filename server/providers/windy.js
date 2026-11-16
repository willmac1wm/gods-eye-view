// Public webcams (beach / surf / shore) for the cape-webcams layer via
// the Windy webcams API (https://api.windy.com/). Port of the old app's
// app/windy_cams.py (same endpoint, same parse, same payload shape).
//
// Free API key via registration at https://api.windy.com/ — set
// WINDY_API_KEY in env. Without it this module is inert: configured()
// is false and the endpoint answers 200 { configured: false,
// cameras: [] }, and the map falls back to the bundled public ferry
// webcams. The key never reaches the browser: it goes in the
// x-windy-api-key header, server-side only.
//
// Uses Webcams API v3 (the v2 /api/webcams/v2/list endpoint is gone —
// 404 as of 2026-10-12).
//
// Free-tier notes: image URLs carry short-lived tokens (~10-15 min),
// so the cache refreshes every 9 minutes and URLs are never persisted.
// Check Windy's terms for commercial display before relying on embeds.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const API_URL = 'https://api.windy.com/webcams/api/v3/webcams';
// Cape May County center; 60 km radius catches the shore cams.
const CENTER_LAT = 39.08;
const CENTER_LON = -74.87;
const RADIUS_KM = 60;
const REFRESH_TTL_MS = 540_000; // 9 minutes; free-tier image URLs expire in ~10-15
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/** v3 gives URL strings; v2 gave {"available", "embed"} objects. */
export function playerUrl(player) {
  for (const key of ['live', 'day']) {
    const value = player?.[key];
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object' && value.available && value.embed) {
      return value.embed;
    }
  }
  return '';
}

/** Parse a Windy v3 /webcams payload (v2 list/nearby still accepted). */
export function parseWindyCameras(payload) {
  const cams = [];
  let webcams = payload?.webcams;
  if (webcams == null) webcams = payload?.result?.webcams;
  for (const w of webcams || []) {
    try {
      if (String(w?.status || 'active') !== 'active') continue;
      // Road cams (mostly DelDOT) duplicate the Traffic cameras layer;
      // this layer is for beach / coast / scenery cams.
      const categories = new Set(
        (w?.categories || [])
          .filter((c) => c && typeof c === 'object')
          .map((c) => String(c.id || '').toLowerCase()),
      );
      if (categories.has('traffic')) continue;
      const loc = w?.location || {};
      const lat = loc.latitude;
      const lng = loc.longitude;
      if (lat == null || lng == null) continue;
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lngNum) ||
        latNum < -90 ||
        latNum > 90 ||
        lngNum < -180 ||
        lngNum > 180
      ) {
        continue;
      }
      const img = (w?.images || w?.image || {}).current || {};
      cams.push({
        id: String(w?.webcamId ?? w?.id ?? ''),
        title: String(w?.title || 'Webcam'),
        lat: latNum,
        lng: lngNum,
        city: String(loc.city || ''),
        image_url: img.preview || img.thumbnail || '',
        player_url: playerUrl(w?.player || {}),
      });
    } catch {
      continue;
    }
  }
  return cams;
}

export function windyProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  const apiKey = () => String(env.WINDY_API_KEY || '').trim();

  async function load() {
    const params = new URLSearchParams({
      nearby: `${CENTER_LAT},${CENTER_LON},${RADIUS_KM}`,
      include: 'location,images,player,categories',
      limit: '50',
    });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(`${API_URL}?${params}`, {
      signal,
      headers: { 'x-windy-api-key': apiKey() },
    });
    if (!response.ok) throw new Error(`windy_upstream_${response.status}`);
    const payload = await readResponseJsonCapped(
      response,
      MAX_RESPONSE_BYTES,
      signal,
    );
    return { cameras: parseWindyCameras(payload), fetched_at: now() };
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
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    // No key: not configured, not an error.
    if (!apiKey()) {
      return json(200, {
        configured: false,
        cameras: [],
        age_s: null,
      });
    }
    const t = now();
    if (cache && t - cacheAt < REFRESH_TTL_MS) {
      return json(200, {
        configured: true,
        cameras: cache.cameras,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    }
    try {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, {
        configured: true,
        cameras: cache.cameras,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    } catch (error) {
      // Stale beats nothing (the old module returned its last good list).
      if (cache) {
        return json(200, {
          configured: true,
          cameras: cache.cameras,
          age_s: Math.floor((t - cache.fetched_at) / 1000),
          stale: true,
        });
      }
      return json(502, {
        configured: true,
        error: 'windy_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'windy-webcams',
    configureServer({ middlewares }) {
      middlewares.use('/api/windy-webcams', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/windy-webcams', handler);
    },
  };
}
