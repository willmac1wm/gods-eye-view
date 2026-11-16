import { parseNasStatusXml } from '../../src/layers/faaStatus/records.js';
import { readResponseTextCapped } from './common/http.js';

/**
 * FAA National Airspace System (NAS) Status proxy — airport ground stops,
 * ground delays, closures and arrival/departure delays.
 *
 * Upstream: GET https://nasstatus.faa.gov/api/airport-status-information
 * (XML, no key, unauthenticated, U.S. public domain). Verified live
 * 2026-11-16: one national document, regenerated every few minutes, no
 * per-airport query — the proxy parses it and filters to ACY/PHL/EWR
 * plus nationwide per-category counts. CORS is NOT enabled on
 * nasstatus.faa.gov, so the server proxy is the only path; the browser
 * never fetches the FAA directly. The old ASWS (services.faa.gov) is
 * NOT used — its live status is unconfirmed.
 *
 * Routes:
 *   GET /api/faa-status        → {fetchedAt, stale, ttlMs, updateTime, updateTimeMs, local, nationwide, totalAirports}
 *   GET /api/faa-status/status → {lastFetch, stale, ttlMs, updateTime, localEventCount, nationwideGroundStops}
 *
 * @returns {import('vite').Plugin}
 */

export const FAA_STATUS_PROXY_TTL_MS = 2 * 60_000;
export const FAA_STATUS_PROXY_TIMEOUT_MS = 10_000;
export const FAA_STATUS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
export const FAA_STATUS_UPSTREAM_URL =
  'https://nasstatus.faa.gov/api/airport-status-information';
const FAA_STATUS_MAX_RESPONSE_BYTES = 1024 * 1024;
const FAA_STATUS_BACKOFF_MS = 60_000;

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

export function faaStatusProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, parsed: object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(FAA_STATUS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(FAA_STATUS_UPSTREAM_URL, {
      signal,
      headers: {
        Accept: 'application/xml, text/xml',
        'User-Agent': FAA_STATUS_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('FAA NAS Status rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const xml = await readResponseTextCapped(
      res,
      FAA_STATUS_MAX_RESPONSE_BYTES,
      signal,
    );
    const parsed = parseNasStatusXml(xml);
    return { at: now(), parsed };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: FAA_STATUS_PROXY_TTL_MS,
      updateTime: entry.parsed.updateTime,
      updateTimeMs: entry.parsed.updateTimeMs,
      local: entry.parsed.local,
      nationwide: entry.parsed.nationwide,
      totalAirports: entry.parsed.totalAirports,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/faa-status', async (req, res) => {
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
            stale: mem ? now() - mem.at >= FAA_STATUS_PROXY_TTL_MS : false,
            ttlMs: FAA_STATUS_PROXY_TTL_MS,
            updateTime: mem ? mem.parsed.updateTime : null,
            localEventCount: mem ? mem.parsed.local.length : 0,
            nationwideGroundStops: mem ? mem.parsed.nationwide.groundStop : 0,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < FAA_STATUS_PROXY_TTL_MS) {
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
            error:
              lastFailure ??
              'FAA NAS Status fetch failed and no cache available',
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
              backoffUntil = now() + (retryAfterMs ?? FAA_STATUS_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'FAA NAS Status rate limited (HTTP 429)'
                  : null;
              warn(
                `[faa-status-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error:
              lastFailure ??
              'FAA NAS Status fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[faa-status-proxy] error:', err?.message || err);
        sendJson(500, { error: 'faa-status proxy error' });
      }
    });
  };
  return {
    name: 'faa-status-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
