import {
  GAUGES_SITES,
  GAUGES_PARAMETERS,
} from '../../src/layers/gauges/sites.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * USGS Water Data API v1 (OGC API) proxy — live river/stream gauges.
 *
 * Upstream (base https://api.waterdata.usgs.gov/ogcapi/v1):
 *   GET /collections/latest-continuous/items?f=json
 *       &monitoring_location_id=USGS-01411000,USGS-01411300
 *       &parameter_code=00060,00065&limit=10
 *
 * Verified live 2026-11-16, keyless, no token: the v1 API answers 200
 * without any registration, and sends `Access-Control-Allow-Origin: *`.
 * The proxy is still the shipped path (one cached server call per cycle,
 * consistent backoff, no per-visitor fan-out). The legacy WaterServices
 * endpoint (waterservices.usgs.gov) is NOT used: USGS decommissions it
 * 2027-02-22, with intentional outages Jan 27 + Feb 16, 2027.
 *
 * Batching, verified live: repeated query params do NOT batch (the API
 * keeps the last value of each); comma-separated values DO — one call
 * covers both sites and both parameters (00060 discharge, 00065 gage
 * height). Gage height is feet above gage datum, not NAVD88. All IV data
 * is provisional / subject to revision.
 *
 * Routes:
 *   GET /api/gauges        → {fetchedAt, stale, ttlMs, features}
 *   GET /api/gauges/status → {lastFetch, stale, ttlMs, gaugeCount, readingCount}
 *
 * @returns {import('vite').Plugin}
 */

export const GAUGES_PROXY_TTL_MS = 15 * 60_000;
export const GAUGES_PROXY_TIMEOUT_MS = 10_000;
export const GAUGES_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const GAUGES_MAX_RESPONSE_BYTES = 1024 * 1024;
const GAUGES_BACKOFF_MS = 60_000;
const GAUGES_BASE =
  'https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items';

export function gaugesUpstreamUrl() {
  const query = new URLSearchParams({
    f: 'json',
    monitoring_location_id: GAUGES_SITES.map((site) => `USGS-${site.id}`).join(
      ',',
    ),
    parameter_code: Object.values(GAUGES_PARAMETERS).join(','),
    limit: '10',
  });
  return `${GAUGES_BASE}?${query}`;
}

function parseRetryAfterMs(response, now) {
  const raw = response?.headers?.get?.('Retry-After');
  if (raw == null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 60 * 60_000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now());
  return null;
}

export function gaugesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, features: object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(GAUGES_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(gaugesUpstreamUrl(), {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': GAUGES_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('USGS rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await readResponseJsonCapped(
      res,
      GAUGES_MAX_RESPONSE_BYTES,
      signal,
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('non-JSON upstream response');
    return { at: now(), features: payload };
  }

  function readingCount(entry) {
    const features = entry.features?.features;
    return Array.isArray(features) ? features.length : null;
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: GAUGES_PROXY_TTL_MS,
      features: entry.features,
      readingCount: readingCount(entry),
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/gauges', async (req, res) => {
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

        if (subPath === '/status') {
          sendJson(200, {
            lastFetch: mem ? mem.at : null,
            stale: mem ? now() - mem.at >= GAUGES_PROXY_TTL_MS : false,
            ttlMs: GAUGES_PROXY_TTL_MS,
            gaugeCount: GAUGES_SITES.length,
            readingCount: mem ? readingCount(mem) : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < GAUGES_PROXY_TTL_MS) {
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
            error: lastFailure ?? 'USGS fetch failed and no cache available',
          });
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              const retryAfterMs =
                err?.rateLimited === true ? err.retryAfterMs : null;
              backoffUntil = now() + (retryAfterMs ?? GAUGES_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'USGS rate limited (HTTP 429)'
                  : null;
              warn(
                `[gauges-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'USGS fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[gauges-proxy] error:', err?.message || err);
        sendJson(500, { error: 'gauges proxy error' });
      }
    });
  };
  return {
    name: 'gauges-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
