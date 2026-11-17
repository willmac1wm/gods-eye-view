import { readResponseJsonCapped } from './common/http.js';

/**
 * MassOutage.com county outage proxy.
 *
 * Upstream (base https://massoutage.com, FIPS 34009 = Cape May County):
 *   GET /api/v1/live/counties/34009           county headline
 *   GET /api/v1/live/counties/34009/areas?active=true   per-town breakdown
 *   GET /api/v1/live/counties/34009/alerts    threshold evaluation
 * (The incidents endpoint was live-verified 2026-11-16 returning [] while
 * the county headline reported incident_count 4, so it is not a runtime
 * source here; the per-town areas endpoint carries the map geometry.)
 *
 * MassOutage data is licensed CC BY 4.0; the layer panel credits
 * "MassOutage (massoutage.com), unofficial aggregate". The feed is an
 * unofficial aggregate — for operational decisions confirm with the
 * utility / NJOEM / DOE EAGLE-I. Never present it as authoritative.
 *
 * Auth: keyless works (open CORS, GET only). A free key — created at
 * https://massoutage.com/account/api — is sent as
 * `Authorization: Bearer <key>` when MASSOUTAGE_API_KEY is set in server
 * env. Without a key, server-side callers are limited to 5 requests per
 * 5 minutes per IP; with a key, 60 points/minute (county live endpoints
 * cost 1 point each). This proxy makes 3 upstream calls per refresh and
 * caches 5 minutes, so both tiers fit — but the key removes the risk of a
 * shared server IP colliding with other callers.
 *
 * Rate-limit handling: on HTTP 429 honor Retry-After; keyless callers that
 * keep polling through 429s get escalating backoff windows (10 → 20 → 40
 * min, capped at 60 min) — the proxy applies that escalation itself and
 * serves stale cache while backed off. On 5xx/network error: keep the last
 * good response and show its as_of; data older than 30 min is stale.
 *
 * PowerOutage.us is NOT a source here: its terms prohibit scraping and its
 * API is paid. MassOutage only.
 *
 * Routes:
 *   GET /api/outages        → {fetchedAt, stale, ttlMs, county, areas, alerts}
 *   GET /api/outages/status → {hasKey, lastFetch, stale, ttlMs, customersOut, majorEvent}
 *
 * @returns {import('vite').Plugin}
 */

export const OUTAGES_PROXY_TTL_MS = 5 * 60_000;
export const OUTAGES_PROXY_TIMEOUT_MS = 10_000;
export const OUTAGES_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
export const OUTAGES_COUNTY_FIPS = '34009';
const OUTAGES_MAX_RESPONSE_BYTES = 1024 * 1024;
/** Keyless 429 escalation: 10 → 20 → 40 min, capped at 60 min. */
const OUTAGES_KEYLESS_BACKOFF_MS = [10, 20, 40, 60].map(
  (minutes) => minutes * 60_000,
);
const OUTAGES_KEYED_BACKOFF_MS = 60_000;
const OUTAGES_BASE = 'https://massoutage.com/api/v1/live/counties';

export function outagesUpstreamUrls(fips = OUTAGES_COUNTY_FIPS) {
  return {
    county: `${OUTAGES_BASE}/${fips}`,
    areas: `${OUTAGES_BASE}/${fips}/areas?active=true`,
    alerts: `${OUTAGES_BASE}/${fips}/alerts`,
  };
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

export function outagesProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, county: object, areas: Array<object>, alerts: object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let backoffStep = 0;
  let lastFailure = null;

  const apiKey = () => String(env?.MASSOUTAGE_API_KEY || '').trim();

  function headers(key) {
    const headers = {
      Accept: 'application/json',
      'User-Agent': OUTAGES_PROXY_USER_AGENT,
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async function fetchUpstreamJson(url, key, signal) {
    const res = await fetchImpl(url, { signal, headers: headers(key) });
    if (res.status === 429) {
      const error = new Error('MassOutage rate limited (HTTP 429)');
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
      OUTAGES_MAX_RESPONSE_BYTES,
      signal,
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('non-JSON upstream response');
    if (payload.error != null)
      throw new Error(`MassOutage: ${String(payload.error)}`);
    return payload;
  }

  /**
   * One batched upstream pass: county + areas + alerts in parallel. All
   * three are required for a fresh payload — a partial refresh would mix
   * timestamps from different polls. Throws on any failure; the caller
   * serves stale cache or a 502.
   */
  async function refreshUpstream(key) {
    const signal = AbortSignal.timeout(OUTAGES_PROXY_TIMEOUT_MS);
    const urls = outagesUpstreamUrls();
    const [county, areas, alerts] = await Promise.all([
      fetchUpstreamJson(urls.county, key, signal),
      fetchUpstreamJson(urls.areas, key, signal),
      fetchUpstreamJson(urls.alerts, key, signal),
    ]);
    return { at: now(), county, areas, alerts };
  }

  function buildPayload(entry, stale) {
    const customersOut =
      entry.county?.data?.customers_out ?? entry.county?.customersOut ?? null;
    const majorEvent = Array.isArray(entry.alerts?.data?.utilities)
      ? entry.alerts.data.utilities.some(
          (utility) => utility.major_event === true,
        )
      : null;
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: OUTAGES_PROXY_TTL_MS,
      county: entry.county,
      areas: entry.areas,
      alerts: entry.alerts,
      customersOut: Number.isFinite(customersOut) ? customersOut : null,
      majorEvent,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/outages', async (req, res) => {
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
          sendJson(200, {
            hasKey: Boolean(key),
            lastFetch: mem ? mem.at : null,
            stale: mem ? now() - mem.at >= OUTAGES_PROXY_TTL_MS : false,
            ttlMs: OUTAGES_PROXY_TTL_MS,
            customersOut: mem ? buildPayload(mem, false).customersOut : null,
            majorEvent: mem ? buildPayload(mem, false).majorEvent : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < OUTAGES_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // In backoff after a 429 / repeated failures: serve stale, do not
        // hammer the upstream. A cold cache in backoff still answers 502.
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error:
              lastFailure ?? 'MassOutage fetch failed and no cache available',
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
              backoffUntil = 0;
              backoffStep = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              const retryAfterMs =
                err?.rateLimited === true ? err.retryAfterMs : null;
              if (err?.rateLimited === true) {
                // Keyless 429s escalate 10 → 20 → 40 min (cap 60); a keyed
                // caller only backs off the Retry-After (or 60 s).
                backoffUntil =
                  now() +
                  (retryAfterMs ??
                    (key
                      ? OUTAGES_KEYED_BACKOFF_MS
                      : OUTAGES_KEYLESS_BACKOFF_MS[
                          Math.min(
                            backoffStep,
                            OUTAGES_KEYLESS_BACKOFF_MS.length - 1,
                          )
                        ]));
                backoffStep += 1;
              } else {
                backoffUntil = now() + OUTAGES_KEYED_BACKOFF_MS;
              }
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message; anything else
              // falls back to the generic "no cache available" text.
              lastFailure =
                err?.rateLimited === true
                  ? 'MassOutage rate limited (HTTP 429)'
                  : null;
              warn(
                `[outages-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
              lastFailure ?? 'MassOutage fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[outages-proxy] error:', err?.message || err);
        sendJson(500, { error: 'outages proxy error' });
      }
    });
  };
  return {
    name: 'outages-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
