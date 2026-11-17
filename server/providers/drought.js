import { countyDrought } from '../../src/layers/drought/records.js';
import {
  COUNTY_SAMPLE_POINTS,
  DROUGHT_URL,
} from '../../src/layers/drought/policy.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * U.S. Drought Monitor proxy.
 *
 * Upstream (keyless, public):
 *   GET https://droughtmonitor.unl.edu/data/json/usdm_current.json
 *   — GeoJSON FeatureCollection, one feature per DM category (0–4),
 *   national polygons. NOTE: the /data/geojson/usdm_current.geojson
 *   path 404s (verified 2026-11-16); the /data/json/ path above is the
 *   working one.
 *
 * Verified live 2026-11-16: 5 features; Last-Modified Thu, 12 Nov 2026
 * 11:15:51 GMT (weekly Thursday release). Point-in-polygon for the
 * county seat (−74.90, 39.08) → DM 0 only: Cape May County is D0 —
 * Abnormally Dry on the current map.
 *
 * The proxy downloads the national file, runs the county-max rule over
 * the sample points, and serves a tiny JSON — the browser never
 * downloads the national polygons. Cadence: once a day (the map only
 * changes on Thursdays). On upstream failure serve the last cached
 * category with its release date, labeled stale.
 *
 * Routes:
 *   GET /api/drought        → {fetchedAt, releasedAt, stale, ttlMs, category, categories}
 *   GET /api/drought/status → {lastFetch, stale, ttlMs, category, releasedAt}
 *
 * @returns {import('vite').Plugin}
 */

export const DROUGHT_PROXY_TTL_MS = 24 * 60 * 60_000;
export const DROUGHT_PROXY_TIMEOUT_MS = 15_000;
export const DROUGHT_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const DROUGHT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DROUGHT_BACKOFF_MS = 60_000;

export function droughtProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, releasedAt: string|null, category: number|null, categories: Array}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(DROUGHT_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(DROUGHT_URL, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': DROUGHT_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const releasedAt = res.headers?.get?.('last-modified') ?? null;
    const payload = await readResponseJsonCapped(
      res,
      DROUGHT_MAX_RESPONSE_BYTES,
      signal,
    );
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.features)
    )
      throw new Error('USDM response missing features');
    const result = countyDrought(payload.features, COUNTY_SAMPLE_POINTS);
    return {
      at: now(),
      releasedAt,
      category: result.category,
      categories: result.categories,
    };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      releasedAt: entry.releasedAt,
      stale,
      ttlMs: DROUGHT_PROXY_TTL_MS,
      category: entry.category,
      categories: entry.categories,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/drought', async (req, res) => {
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
            stale: mem ? now() - mem.at >= DROUGHT_PROXY_TTL_MS : false,
            ttlMs: DROUGHT_PROXY_TTL_MS,
            category: mem ? mem.category : null,
            releasedAt: mem ? mem.releasedAt : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < DROUGHT_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'USDM fetch failed and no cache available',
          });
          return;
        }
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              backoffUntil = now() + DROUGHT_BACKOFF_MS;
              lastFailure = null;
              warn(
                `[drought-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'USDM fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[drought-proxy] error:', err?.message || err);
        sendJson(500, { error: 'drought proxy error' });
      }
    });
  };
  return {
    name: 'drought-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
