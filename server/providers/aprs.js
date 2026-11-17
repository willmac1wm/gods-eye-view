import {
  APRS_STATIONS,
  aprsStationNames,
} from '../../src/layers/aprs/stations.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * aprs.fi / CWOP weather proxy.
 *
 * Upstream: GET https://api.aprs.fi/api/get?name=<calls>&what=wx&apikey=<key>&format=json
 * (one batched call for the whole registry — at most 20 targets per call).
 * aprs.fi sends NO CORS headers (verified: Origin request → 200 with no
 * Access-Control-Allow-Origin; OPTIONS → 405), so the browser can never
 * fetch it directly — and the key must never reach the browser anyway.
 * The key lives in server env only (APRSFI_API_KEY); the URL is never
 * logged because it embeds the key.
 *
 * aprs.fi terms (https://api.aprs.fi/page/api), recorded verbatim in
 * effect:
 * - "You are required to credit aprs.fi as the source of the data, and to
 *   provide a link back to aprs.fi." → the layer panel carries
 *   "Weather: aprs.fi" + link; see DATA_SOURCES.md.
 * - "The API may only be used by applications which are free to use and
 *   available to the general public." Cape Dispatch / gods-eye-view is
 *   free and public.
 * - "The application may only request data when it is actively needed by
 *   the end-user. Do not preload, pre-cache, or collect data using the API
 *   for archival purposes." → the client fetches only while the layer is
 *   enabled, and this proxy keeps NO disk cache of weather payloads
 *   (memory cache only, dropped on restart).
 * - "Caching is good. … fetch it from aprs.fi, and cache it for some time
 *   so that you can reuse it in case some other user needs the same data."
 *   → 5-minute memory cache + single-flight, matching the stations'
 *   ~5-minute report cadence.
 * - "Your application must identify its unique name, version, and a link
 *   to its home page in the HTTP User-Agent header" → the proxy sends
 *   `User-Agent: gods-eye-view/1.0 (+https://capemaydispatch.com)`.
 * - No availability guarantee: time out in a few seconds and, on repeated
 *   failures, slow down with exponential backoff → 10 s upstream timeout,
 *   serve-stale-on-failure, exponential backoff between refresh attempts.
 *
 * findu.com is NOT a runtime source: its policy forbids screen-scraping /
 * repetitive programmatic access. It was used for one-off discovery only.
 *
 * Routes:
 *   GET /api/aprs        → {fetchedAt, stale, ttlMs, count, stations: [...]}
 *   GET /api/aprs/status → {hasKey, lastFetch, count, stale, ttlMs}
 *
 * Keyless (no APRSFI_API_KEY): /api/aprs → 503 {error:'no_key'}; status →
 * {hasKey:false}. Upstream is never touched without a key.
 *
 * @returns {import('vite').Plugin}
 */

export const APRS_PROXY_TTL_MS = 5 * 60_000;
export const APRS_PROXY_TIMEOUT_MS = 10_000;
export const APRS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const APRS_MAX_RESPONSE_BYTES = 1024 * 1024;
/** First retry after 15 s, doubling, capped at 5 min. */
const APRS_BACKOFF_BASE_MS = 15_000;
const APRS_BACKOFF_MAX_MS = 5 * 60_000;

export function aprsUpstreamUrl(key, stations = APRS_STATIONS) {
  const query = new URLSearchParams({
    name: aprsStationNames(stations),
    what: 'wx',
    apikey: key,
    format: 'json',
  });
  return `https://api.aprs.fi/api/get?${query}`;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Shape one upstream `what=wx` entry (metric, Unix-second `time`) into a
 * proxy row. Stations absent from `entries` still get a row with
 * `missing: true`, so the panel shows "not reporting" instead of silently
 * shrinking the list.
 */
export function buildAprsProxyStations(entries) {
  const byName = new Map();
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const name = String(entry.name ?? '')
        .trim()
        .toUpperCase();
      if (name && !byName.has(name)) byName.set(name, entry);
    }
  }
  return APRS_STATIONS.map((station) => {
    const base = {
      callsign: station.callsign,
      place: station.place,
      lat: station.lat,
      lon: station.lon,
    };
    const entry = byName.get(station.callsign);
    if (!entry) {
      return {
        ...base,
        timeMs: null,
        tempC: null,
        humidity: null,
        pressureMb: null,
        windDirDeg: null,
        windSpeedMps: null,
        windGustMps: null,
        rain1hMm: null,
        rain24hMm: null,
        rainMnMm: null,
        luminosity: null,
        missing: true,
      };
    }
    const timeSeconds = finiteOrNull(entry.time);
    return {
      ...base,
      timeMs: timeSeconds == null ? null : timeSeconds * 1000,
      tempC: finiteOrNull(entry.temp),
      humidity: finiteOrNull(entry.humidity),
      pressureMb: finiteOrNull(entry.pressure),
      windDirDeg: finiteOrNull(entry.wind_direction),
      windSpeedMps: finiteOrNull(entry.wind_speed),
      windGustMps: finiteOrNull(entry.wind_gust),
      rain1hMm: finiteOrNull(entry.rain_1h),
      rain24hMm: finiteOrNull(entry.rain_24h),
      rainMnMm: finiteOrNull(entry.rain_mn),
      luminosity: finiteOrNull(entry.luminosity),
      missing: timeSeconds == null,
    };
  });
}

export function aprsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, stations: Array<object>}} */
  let mem = null;
  /** @type {?Promise<?{at: number, stations: Array<object>}>} single-flight refresh */
  let inflight = null;
  let consecutiveFailures = 0;
  let backoffUntil = 0;
  /**
   * The last aprs.fi `result:"fail"` description, if any (never the key:
   * descriptions come from aprs.fi, but a value containing the key is
   * dropped rather than risked). Surfaced on a cold-cache 502 so a bad key
   * is diagnosable; plain HTTP failures keep the generic message.
   */
  let lastFailure = null;

  const apiKey = () => String(env?.APRSFI_API_KEY || '').trim();

  function backoffDelayMs() {
    // consecutiveFailures was already incremented: first failure → 15 s.
    return Math.min(
      APRS_BACKOFF_MAX_MS,
      APRS_BACKOFF_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    );
  }

  /**
   * One batched upstream call. Throws on HTTP error, oversized/non-JSON
   * body, or an aprs.fi `result:"fail"` payload (e.g. a bad key) — the
   * caller serves stale cache or a 502. The URL (and key) are never logged.
   */
  async function refreshUpstream(key) {
    const signal = AbortSignal.timeout(APRS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(aprsUpstreamUrl(key), {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': APRS_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await readResponseJsonCapped(
      res,
      APRS_MAX_RESPONSE_BYTES,
      signal,
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('non-JSON upstream response');
    if (payload.result === 'fail') {
      const description = String(
        payload.description || 'aprs.fi request failed',
      );
      const error = new Error(`aprs.fi: ${description}`);
      // Kept separate so the 502 can carry the (key-free) description.
      error.aprsDescription = description;
      throw error;
    }
    return { at: now(), stations: buildAprsProxyStations(payload.entries) };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: APRS_PROXY_TTL_MS,
      count: entry.stations.filter((station) => !station.missing).length,
      stations: entry.stations,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/aprs', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        const key = apiKey();

        if (subPath === '/status') {
          if (!key) {
            sendJson(200, {
              hasKey: false,
              lastFetch: null,
              count: null,
              stale: false,
              ttlMs: APRS_PROXY_TTL_MS,
            });
            return;
          }
          sendJson(200, {
            hasKey: true,
            lastFetch: mem ? mem.at : null,
            count: mem
              ? mem.stations.filter((station) => !station.missing).length
              : null,
            stale: mem ? now() - mem.at >= APRS_PROXY_TTL_MS : false,
            ttlMs: APRS_PROXY_TTL_MS,
          });
          return;
        }

        if (!key) {
          sendJson(503, { error: 'no_key' });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < APRS_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // In backoff after repeated failures: serve stale, do not hammer
        // the upstream. A cold cache in backoff still answers 502.
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'aprs.fi fetch failed and no cache available',
          });
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream(key)
            .then((fresh) => {
              mem = fresh;
              consecutiveFailures = 0;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              consecutiveFailures += 1;
              backoffUntil = now() + backoffDelayMs();
              const description =
                typeof err?.aprsDescription === 'string'
                  ? err.aprsDescription
                  : null;
              lastFailure =
                description && !description.includes(key)
                  ? `aprs.fi: ${description}`
                  : null;
              warn(
                `[aprs-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error: lastFailure ?? 'aprs.fi fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[aprs-proxy] error:', err?.message || err);
        sendJson(500, { error: 'aprs proxy error' });
      }
    });
  };
  return {
    name: 'aprs-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
