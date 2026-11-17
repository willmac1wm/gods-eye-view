import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from './common/http.js';

/**
 * NOAA Space Weather Prediction Center (SWPC) proxy.
 *
 * Upstreams (all keyless, public domain, base
 * https://services.swpc.noaa.gov):
 *   GET /json/planetary_k_index_1m.json            — current Kp, 1-min
 *   GET /products/noaa-planetary-k-index-forecast.json — 3-day Kp, 3-hourly
 *   GET /text/3-day-forecast.txt                   — G/R/S wording + rationale
 *   GET /json/ace/swepam/ace_swepam_1h.json        — solar wind speed/density
 *   GET /json/ace/mag/ace_mag_1h.json              — IMF Bt / Bz (GSM)
 *
 * Verified live 2026-11-16: Kp 0 right now (latest 22:27 UTC); forecast
 * max expected Kp 4.67 (G1) Nov 17–18; ACE 1 h files live. The
 * products/solar-wind/plasma-2-hour.json and mag-2-hour.json paths 404 —
 * do not use them.
 *
 * Cadence: Kp + ACE refresh every 5 minutes; the forecast + 3-day text
 * every 6 hours (SWPC updates the 3-day forecast twice daily). On
 * upstream failure serve the last good payload per family, labeled
 * stale; a cold cache answers 502. Kp unknown is never guessed — the
 * card says "Kp unavailable" and shows the forecast only.
 *
 * Routes:
 *   GET /api/space-weather        → {fetchedAt, stale, kpMinute, kpForecast, threeDayText, aceSwepam, aceMag}
 *   GET /api/space-weather/status → {lastFetch, stale, kp}
 *
 * @returns {import('vite').Plugin}
 */

export const SPACE_WEATHER_FAST_TTL_MS = 5 * 60 * 1000;
export const SPACE_WEATHER_SLOW_TTL_MS = 6 * 60 * 60_000;
export const SPACE_WEATHER_PROXY_TIMEOUT_MS = 15_000;
export const SPACE_WEATHER_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const SPACE_WEATHER_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SPACE_WEATHER_BACKOFF_MS = 60_000;
const SPACE_WEATHER_BASE = 'https://services.swpc.noaa.gov';

const FAST_PRODUCTS = Object.freeze({
  kpMinute: '/json/planetary_k_index_1m.json',
  aceSwepam: '/json/ace/swepam/ace_swepam_1h.json',
  aceMag: '/json/ace/mag/ace_mag_1h.json',
});

const SLOW_PRODUCTS = Object.freeze({
  kpForecast: '/products/noaa-planetary-k-index-forecast.json',
  threeDayText: '/text/3-day-forecast.txt',
});

export function spaceWeatherProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  let fast = null;
  let slow = null;
  let fastInflight = null;
  let slowInflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function fetchProduct(path, signal, asJson = true) {
    const res = await fetchImpl(`${SPACE_WEATHER_BASE}${path}`, {
      signal,
      headers: {
        Accept: asJson ? 'application/json' : 'text/plain',
        'User-Agent': SPACE_WEATHER_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status} for ${path}`);
    }
    return asJson
      ? readResponseJsonCapped(res, SPACE_WEATHER_MAX_RESPONSE_BYTES, signal)
      : readResponseTextCapped(res, SPACE_WEATHER_MAX_RESPONSE_BYTES, signal);
  }

  async function refreshFamily(products, signal) {
    const entries = await Promise.all(
      Object.entries(products).map(async ([key, path]) => {
        try {
          const value = await fetchProduct(
            path,
            signal,
            key !== 'threeDayText',
          );
          return [key, value];
        } catch {
          return [key, null];
        }
      }),
    );
    return Object.fromEntries(entries);
  }

  function buildPayload(stale) {
    return {
      fetchedAt: fast?.at ?? slow?.at ?? null,
      stale,
      kpMinute: fast?.data?.kpMinute ?? null,
      kpForecast: slow?.data?.kpForecast ?? null,
      threeDayText: slow?.data?.threeDayText ?? null,
      aceSwepam: fast?.data?.aceSwepam ?? null,
      aceMag: fast?.data?.aceMag ?? null,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/space-weather', async (req, res) => {
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
            lastFetch: fast?.at ?? null,
            stale: fast ? now() - fast.at >= SPACE_WEATHER_FAST_TTL_MS : true,
            kp: fast?.data?.kpMinute?.at(-1)?.estimated_kp ?? null,
          });
          return;
        }

        const t = now();
        const fastFresh = fast && t - fast.at < SPACE_WEATHER_FAST_TTL_MS;
        const slowFresh = slow && t - slow.at < SPACE_WEATHER_SLOW_TTL_MS;
        if (fastFresh && slowFresh) {
          sendJson(200, buildPayload(false));
          return;
        }
        if (t < backoffUntil) {
          if (fast?.data?.kpMinute) {
            sendJson(200, buildPayload(true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'SWPC fetch failed and no cache available',
          });
          return;
        }
        const signal = AbortSignal.timeout(SPACE_WEATHER_PROXY_TIMEOUT_MS);
        const jobs = [];
        if (!fastFresh) {
          if (!fastInflight) {
            fastInflight = refreshFamily(FAST_PRODUCTS, signal)
              .then((data) => {
                if (data.kpMinute) fast = { at: now(), data };
                return fast;
              })
              .catch(() => null)
              .finally(() => {
                fastInflight = null;
              });
          }
          jobs.push(fastInflight);
        }
        if (!slowFresh) {
          if (!slowInflight) {
            slowInflight = refreshFamily(SLOW_PRODUCTS, signal)
              .then((data) => {
                if (data.kpForecast || data.threeDayText)
                  slow = { at: now(), data };
                return slow;
              })
              .catch(() => null)
              .finally(() => {
                slowInflight = null;
              });
          }
          jobs.push(slowInflight);
        }
        await Promise.all(jobs);
        if (fast?.data?.kpMinute) {
          const stale =
            now() - fast.at >= SPACE_WEATHER_FAST_TTL_MS ||
            (slow ? now() - slow.at >= SPACE_WEATHER_SLOW_TTL_MS : false);
          sendJson(200, buildPayload(stale));
          return;
        }
        if (fast) {
          sendJson(200, buildPayload(true));
          return;
        }
        backoffUntil = now() + SPACE_WEATHER_BACKOFF_MS;
        sendJson(502, {
          error: lastFailure ?? 'SWPC fetch failed and no cache available',
        });
      } catch (err) {
        warn('[space-weather-proxy] error:', err?.message || err);
        sendJson(500, { error: 'space weather proxy error' });
      }
    });
  };
  return {
    name: 'space-weather-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
