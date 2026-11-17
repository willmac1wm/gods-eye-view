// server/providers/ioda.js
// IODA (Internet Outage Detection and Analysis, Georgia Tech) proxy.
// IODA is free and keyless; responses carry "Copyright (c) 2021-2025
// Georgia Tech Research Corporation" — credit "IODA, Georgia Tech".
// Verified live 2026-11-17: the US and New Jersey summary scopes are
// usually quiet (data:[] over 6 h and 7 d), US-scoped alerts are empty
// over 24 h, and global alerts carry the live signal — so each refresh
// polls the US + NJ summaries (6 h) and the global recent alerts (24 h),
// and says which scope each row came from. An empty window is a real
// result, never an error. Pattern mirrors gdacsProxy (TTL cache,
// single-flight refresh, backoff, serve-stale-on-failure, 502 cold).
//
// Routes:
//   GET /api/internet-outages        → {fetchedAt, stale, ttlMs, window, sources, usSummary, njSummary, alerts}
//   GET /api/internet-outages/status → {lastFetch, stale, ttlMs, counts, sources}
//
// @returns {import('vite').Plugin}
import { readResponseJsonCapped } from './common/http.js';

export const IODA_API_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
export const IODA_NJ_REGION_CODE = '4453';
export const IODA_US_COUNTRY_CODE = 'US';
export const IODA_PROXY_TTL_MS = 5 * 60_000;
export const IODA_PROXY_TIMEOUT_MS = 10_000;
export const IODA_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const IODA_MAX_RESPONSE_BYTES = 1024 * 1024;
const IODA_BACKOFF_MS = 60_000;
const IODA_SUMMARY_WINDOW_SECONDS = 6 * 3600;
const IODA_ALERTS_WINDOW_SECONDS = 24 * 3600;
const IODA_SUMMARY_LIMIT = 25;
const IODA_ALERTS_LIMIT = 20;

/** The upstream API base (exposed for tests). */
export function iodaUpstreamUrl() {
  return IODA_API_BASE;
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

export function iodaProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  const TTL_MS = IODA_PROXY_TTL_MS;
  /** @type {?{at: number, window: object, sources: object, usSummary: Array<object>, njSummary: Array<object>, alerts: Array<object>}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  /** One IODA JSON call. Throws on HTTP error, oversize, or non-JSON. */
  async function fetchJson(path, signal) {
    const res = await fetchImpl(`${IODA_API_BASE}${path}`, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': IODA_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('IODA rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let payload;
    try {
      payload = await readResponseJsonCapped(
        res,
        IODA_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data))
      throw new Error('non-IODA upstream response');
    return payload.data;
  }

  /**
   * Refresh all three scopes. Partial success (≥1 scope ok) still produces
   * a cacheable entry with the failed scope marked ok:false; total failure
   * throws so the caller can serve stale.
   */
  async function refreshUpstream() {
    const until = Math.floor(now() / 1000);
    const summaryFrom = until - IODA_SUMMARY_WINDOW_SECONDS;
    const alertsFrom = until - IODA_ALERTS_WINDOW_SECONDS;
    const signal = AbortSignal.timeout(IODA_PROXY_TIMEOUT_MS);
    const scopes = [
      {
        id: 'usSummary',
        path:
          `/outages/summary?from=${summaryFrom}&until=${until}` +
          `&entityType=country&entityCode=${IODA_US_COUNTRY_CODE}&limit=${IODA_SUMMARY_LIMIT}`,
      },
      {
        id: 'njSummary',
        path:
          `/outages/summary?from=${summaryFrom}&until=${until}` +
          `&entityType=region&entityCode=${IODA_NJ_REGION_CODE}&limit=${IODA_SUMMARY_LIMIT}`,
      },
      {
        id: 'alerts',
        path:
          `/outages/alerts?from=${alertsFrom}&until=${until}` +
          `&limit=${IODA_ALERTS_LIMIT}`,
      },
    ];
    const settled = await Promise.allSettled(
      scopes.map(async (scope) => {
        const data = await fetchJson(scope.path, signal);
        return { scope, data };
      }),
    );
    const sources = {};
    const rows = { usSummary: [], njSummary: [], alerts: [] };
    let rateLimited = null;
    for (const [index, result] of settled.entries()) {
      const scope = scopes[index];
      if (result.status === 'fulfilled') {
        rows[scope.id] = result.value.data;
        sources[scope.id] = {
          ok: true,
          count: result.value.data.length,
        };
      } else {
        const reason = result.reason;
        if (reason?.rateLimited === true && !rateLimited) rateLimited = reason;
        warn(
          `[ioda-proxy] ${scope.id} fetch failed:`,
          reason?.message || reason,
        );
        sources[scope.id] = { ok: false, count: 0 };
      }
    }
    if (!Object.values(sources).some((s) => s.ok)) {
      const error = new Error('all IODA scopes failed');
      if (rateLimited) {
        error.rateLimited = true;
        error.retryAfterMs = rateLimited.retryAfterMs;
      }
      throw error;
    }
    return {
      at: now(),
      window: {
        summaryFrom,
        alertsFrom,
        until,
      },
      sources,
      ...rows,
    };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      window: entry.window,
      sources: entry.sources,
      usSummary: entry.usSummary,
      njSummary: entry.njSummary,
      alerts: entry.alerts,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/internet-outages', async (req, res) => {
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
            stale: mem ? now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            counts: mem
              ? {
                  usSummary: mem.usSummary.length,
                  njSummary: mem.njSummary.length,
                  alerts: mem.alerts.length,
                }
              : null,
            sources: mem ? mem.sources : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < TTL_MS) {
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
            error: lastFailure ?? 'IODA fetch failed and no cache available',
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
              backoffUntil = now() + (retryAfterMs ?? IODA_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'IODA rate limited (HTTP 429)'
                  : null;
              warn(
                `[ioda-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'IODA fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[ioda-proxy] error:', err?.message || err);
        sendJson(500, { error: 'ioda proxy error' });
      }
    });
  };
  return {
    name: 'ioda-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
