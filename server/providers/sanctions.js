// server/providers/sanctions.js
import {
  SANCTIONS_PROXY_TIMEOUT_MS,
  SANCTIONS_PROXY_TTL_MS,
  SANCTIONS_PROXY_USER_AGENT,
  arcnauticalCheckUrl,
} from '../../src/layers/sanctionsWatch/policy.js';
import {
  isValidImo,
  normalizeImo,
  validateScreening,
} from '../../src/layers/sanctionsWatch/records.js';

/**
 * ArcNautical vessel sanctions-check proxy.
 *
 * Upstream (keyless, verified live 2026-11-17):
 *   GET https://arcnautical.com/api/v1/vessels/{imo}/check
 *   → 200 {imo, vesselName, sanctions: {status GREEN|match, ...},
 *          ownership: {opacity, score}, vetting: {grade, score},
 *          checkedAt, fullReport, tier: "keyless"}
 *   IMO 9169067 "MSC MIA SUMMER II": GREEN, ownership HIGH 70,
 *   vetting C 43.
 *
 * The keyless tier is an on-demand lookup (100 req/hr/IP, "a sample
 * for evaluation and occasional lookups, not a data feed") — the proxy
 * caches one hour per IMO (the docs: a hull checked in the last hour
 * answers from cache at once) and never screens the same IMO twice in
 * that window. On 429/503 it honors Retry-After, stops screening, and
 * serves the last cached screening labeled stale; with no cache it
 * answers 502. The browser never calls ArcNautical directly.
 * A free API key (William mints it on return) raises the allowance to
 * 2,000 screenings and returns the full record — keyless works without
 * it, and this proxy sends no key today.
 *
 * Routes:
 *   GET /api/sanctions/check?imo=9169067 → screening + stale flag
 *
 * @returns {import('vite').Plugin}
 */
export function sanctionsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** imo -> {at: number, screening: ?object} */
  const cache = new Map();
  /** imo -> Promise<?object> single-flight refresh */
  const inflight = new Map();
  let backoffUntil = 0;
  let lastFailure = null;

  function parseRetryAfter(res) {
    const raw = res.headers?.get?.('retry-after');
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0)
      return Math.min(seconds, 3600) * 1000;
    return 60_000;
  }

  async function fetchScreening(imo) {
    const signal = AbortSignal.timeout(SANCTIONS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(arcnauticalCheckUrl(imo), {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': SANCTIONS_PROXY_USER_AGENT,
      },
    });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 503) {
      const err = new Error(`ArcNautical HTTP ${res.status}`);
      err.retryAfterMs = parseRetryAfter(res);
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`ArcNautical HTTP ${res.status}`);
    const payload = await res.json();
    const screening = validateScreening(payload);
    if (!screening) throw new Error('Malformed ArcNautical response');
    return screening;
  }

  function refresh(imo) {
    if (!inflight.has(imo)) {
      const pending = fetchScreening(imo)
        .then((screening) => {
          if (screening) cache.set(imo, { at: now(), screening });
          backoffUntil = 0;
          lastFailure = null;
          return screening;
        })
        .catch((err) => {
          if (err?.rateLimited) backoffUntil = now() + err.retryAfterMs;
          lastFailure = err?.message || String(err);
          warn(
            `[sanctions-proxy] refresh failed (${lastFailure}) — serving cache if any`,
          );
          return null;
        })
        .finally(() => {
          inflight.delete(imo);
        });
      inflight.set(imo, pending);
    }
    return inflight.get(imo);
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/sanctions/check', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const url = new URL(req.url || '', 'http://localhost');
        const imo = normalizeImo(url.searchParams.get('imo'));
        if (!imo || !isValidImo(imo)) {
          sendJson(400, { error: 'A valid 7-digit IMO number is required' });
          return;
        }
        const entry = cache.get(imo);
        if (entry && now() - entry.at < SANCTIONS_PROXY_TTL_MS) {
          sendJson(200, { ...entry.screening, stale: false });
          return;
        }
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, { ...entry.screening, stale: true });
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'Sanctions screening paused — rate limit',
          });
          return;
        }
        const screening = await refresh(imo);
        if (screening) {
          sendJson(200, { ...screening, stale: false });
        } else if (entry) {
          sendJson(200, { ...entry.screening, stale: true });
        } else if (lastFailure) {
          sendJson(502, { error: lastFailure });
        } else {
          sendJson(404, { error: 'Unknown IMO number' });
        }
      } catch (err) {
        warn('[sanctions-proxy] error:', err?.message || err);
        sendJson(500, { error: 'sanctions proxy error' });
      }
    });
  };
  return {
    name: 'sanctions-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
