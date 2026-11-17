// 511NJ traffic incidents and camera locations for the cape-cameras
// layer. Port of the old app's app/nj511.py. Inert until NJ511_API_KEY
// is configured — the app runs fine without it, matching the FIRMS /
// NJ Transit "not configured, not an error" pattern: without a key the
// endpoint answers 200 { configured: false, events: [], cameras: [] }.
//
// ⚠ UNVERIFIED endpoint shape: 511NJ's specific endpoint was not
// independently confirmed (the old environment's network policy blocked
// reaching 511nj.org, and its docs require a registered account). New
// Jersey's 511 service, like many states', runs on the Iteris/511
// multi-state platform — confirmed live for 511NY and 511GA, both
// exposing GetCameras/GetEvents/GetAlerts over the same query shape
// (?key=...&format=json). This module assumes 511NJ shares that
// platform and endpoint convention; VERIFY against a real key before
// trusting field names or the base URL.
//
// William must supply NJ511_API_KEY (free developer key from 511NJ).
// The key never reaches the browser: all calls are server-side.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const BASE_URL = 'https://511nj.org/api';
const CACHE_MS = 300_000; // 5 minutes; matches the other traffic feeds
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** The Iteris GetEvents row shape -> the old nj511 event shape. */
export function mapNj511Event(row) {
  const lat = row?.Latitude ?? row?.latitude;
  const lng = row?.Longitude ?? row?.longitude;
  if (lat == null || lng == null) return null;
  return {
    id: row?.ID ?? row?.id ?? null,
    event_type: row?.EventType ?? row?.Type ?? 'Traffic event',
    description: row?.Description ?? row?.description ?? null,
    road: row?.RoadwayName ?? row?.Facility ?? null,
    lat,
    lng,
    last_updated: row?.LastUpdated ?? row?.lastUpdated ?? null,
  };
}

/** The assumed Iteris GetCameras row shape -> a traffic-camera row. */
export function mapNj511Camera(row) {
  const lat = row?.Latitude ?? row?.latitude;
  const lng = row?.Longitude ?? row?.longitude;
  if (lat == null || lng == null) return null;
  return {
    name: row?.CameraName ?? row?.Name ?? row?.Title ?? '511NJ camera',
    image_url: row?.ImageUrl ?? row?.ImageURL ?? row?.Url ?? row?.URL ?? null,
    road: row?.RoadwayName ?? row?.Facility ?? null,
    lat,
    lng,
    heading: null,
    fov: 60,
    heading_confidence: 'estimated',
    source: '511NJ',
    extra: { id: row?.ID ?? row?.id ?? null },
  };
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.cameras)) return payload.cameras;
  return [];
}

export function nj511Proxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  const apiKey = () => String(env.NJ511_API_KEY || '').trim();

  async function fetchList(endpoint) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const url =
      `${BASE_URL}/${endpoint}?key=${encodeURIComponent(apiKey())}` +
      '&format=json';
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`nj511_upstream_${response.status}`);
    return readResponseJsonCapped(response, MAX_RESPONSE_BYTES, signal);
  }

  async function load() {
    const [eventsPayload, camerasPayload] = await Promise.all([
      fetchList('GetEvents').catch(() => null),
      fetchList('GetCameras').catch(() => null),
    ]);
    const events = rowsOf(eventsPayload).map(mapNj511Event).filter(Boolean);
    const cameras = rowsOf(camerasPayload).map(mapNj511Camera).filter(Boolean);
    return { events, cameras, fetched_at: now() };
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
        events: [],
        cameras: [],
        error: null,
        age_s: null,
      });
    }
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) {
      return json(200, {
        configured: true,
        events: cache.events,
        cameras: cache.cameras,
        error: null,
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
        events: cache.events,
        cameras: cache.cameras,
        error: null,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    } catch (error) {
      if (cache) {
        return json(200, {
          configured: true,
          events: cache.events,
          cameras: cache.cameras,
          error: null,
          age_s: Math.floor((t - cache.fetched_at) / 1000),
          stale: true,
        });
      }
      return json(502, {
        configured: true,
        error: 'nj511_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'nj511',
    configureServer({ middlewares }) {
      middlewares.use('/api/nj511', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/nj511', handler);
    },
  };
}
