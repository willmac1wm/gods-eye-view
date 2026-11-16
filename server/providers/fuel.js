import { FUEL_SERIES } from '../../src/layers/fuel/records.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * U.S. Energy Information Administration (EIA) Open Data API v2 proxy.
 *
 * Upstream (base https://api.eia.gov/v2):
 *   GET petroleum/pri/gnd/data/?frequency=weekly&data[0]=value
 *       &facets[series][]=<id>&sort[0][column]=period
 *       &sort[0][direction]=desc&offset=0&length=52
 *   GET petroleum/pri/wfr/data/?...  (same shape, heating oil + propane)
 *
 * Both routes were verified live 2026-11-16 (gas/diesel route
 * `petroleum/pri/gnd` and heating-oil route `petroleum/pri/wfr`;
 * the PADD 1B diesel series EMD_EPD2D_PTE_R1Y_DPG was confirmed via the
 * route's facet endpoint). Latest values then: week of 2026-11-09 —
 * PADD 1B regular gasoline $4.146/gal, PADD 1B diesel $6.412/gal,
 * NJ residential heating oil $6.052/gal.
 *
 * Auth: a free API key is REQUIRED (register at
 * https://www.eia.gov/opendata/register.php — email only, no card).
 * The key lives in server env only (EIA_API_KEY), sent as the `X-Api-Key`
 * header (preferred — keeps the key out of logs/URLs). There is no
 * keyless tier: without a key the proxy answers 503 {error:'no_key'} and
 * the layer shows the last cached weekly values with their week date, or
 * hides the card. A price is never fabricated.
 *
 * Cadence: EIA publishes gasoline/diesel Monday afternoon ET and heating
 * oil Wednesdays after 1:00 PM ET (Oct–Mar). The proxy caches 6 hours;
 * the layer polls every 6 hours — orders of magnitude below any
 * published throttle. On HTTP 429 back off (Retry-After, else 60 s) and
 * serve stale cache.
 *
 * Routes:
 *   GET /api/fuel        → {fetchedAt, stale, ttlMs, gnd, wfr}
 *   GET /api/fuel/status → {hasKey, lastFetch, stale, ttlMs, latestWeek}
 *
 * @returns {import('vite').Plugin}
 */

export const FUEL_PROXY_TTL_MS = 6 * 60 * 60_000;
export const FUEL_PROXY_TIMEOUT_MS = 15_000;
export const FUEL_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
export const FUEL_HISTORY_ROWS = 52;
const FUEL_MAX_RESPONSE_BYTES = 1024 * 1024;
const FUEL_BACKOFF_MS = 60_000;
const FUEL_BASE = 'https://api.eia.gov/v2/petroleum/pri';

function seriesForRoute(route) {
  return FUEL_SERIES.filter((series) =>
    route === 'gnd'
      ? series.product === 'gasoline' || series.product === 'diesel'
      : series.product === 'heating-oil',
  ).map((series) => series.id);
}

export function eiaFuelUpstreamUrl(route) {
  const query = new URLSearchParams({
    frequency: 'weekly',
    'data[0]': 'value',
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    offset: '0',
    length: String(FUEL_HISTORY_ROWS),
  });
  for (const id of seriesForRoute(route)) {
    query.append('facets[series][]', id);
  }
  return `${FUEL_BASE}/${route}/data/?${query}`;
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

export function fuelProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  env = process.env,
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, gnd: object, wfr: object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  const apiKey = () => String(env?.EIA_API_KEY || '').trim();

  async function fetchUpstreamJson(route, key, signal) {
    const res = await fetchImpl(eiaFuelUpstreamUrl(route), {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': FUEL_PROXY_USER_AGENT,
        'X-Api-Key': key,
      },
    });
    if (res.status === 429) {
      const error = new Error('EIA rate limited (HTTP 429)');
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
      FUEL_MAX_RESPONSE_BYTES,
      signal,
    );
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('non-JSON upstream response');
    return payload;
  }

  /**
   * One batched upstream pass: gas/diesel + heating oil in parallel.
   * Both are required for a fresh payload — a partial refresh would mix
   * release weeks. Throws on any failure; the caller serves stale cache
   * or a 502.
   */
  async function refreshUpstream(key) {
    const signal = AbortSignal.timeout(FUEL_PROXY_TIMEOUT_MS);
    const [gnd, wfr] = await Promise.all([
      fetchUpstreamJson('gnd', key, signal),
      fetchUpstreamJson('wfr', key, signal),
    ]);
    return { at: now(), gnd, wfr };
  }

  function latestWeek(entry) {
    const periods = [];
    for (const payload of [entry.gnd, entry.wfr]) {
      const data = payload?.response?.data;
      if (Array.isArray(data)) {
        for (const row of data) {
          if (typeof row?.period === 'string') periods.push(row.period);
        }
      }
    }
    periods.sort();
    return periods.length ? periods[periods.length - 1] : null;
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: FUEL_PROXY_TTL_MS,
      gnd: entry.gnd,
      wfr: entry.wfr,
      latestWeek: latestWeek(entry),
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/fuel', async (req, res) => {
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
            stale: mem ? now() - mem.at >= FUEL_PROXY_TTL_MS : false,
            ttlMs: FUEL_PROXY_TTL_MS,
            latestWeek: mem ? latestWeek(mem) : null,
          });
          return;
        }

        if (!key) {
          sendJson(503, { error: 'no_key' });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < FUEL_PROXY_TTL_MS) {
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
            error: lastFailure ?? 'EIA fetch failed and no cache available',
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
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              const retryAfterMs =
                err?.rateLimited === true ? err.retryAfterMs : null;
              backoffUntil = now() + (retryAfterMs ?? FUEL_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'EIA rate limited (HTTP 429)'
                  : null;
              warn(
                `[fuel-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'EIA fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[fuel-proxy] error:', err?.message || err);
        sendJson(500, { error: 'fuel proxy error' });
      }
    });
  };
  return {
    name: 'fuel-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
