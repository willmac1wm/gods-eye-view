import {
  COUNTY_SEAT,
  RADNET_CDX_BASE,
  RADNET_MONITORS,
  SAFECAST_SEARCH_RADIUS_M,
  SAFECAST_URL,
} from '../../src/layers/radiation/policy.js';
import {
  distanceKm,
  normalizeSafecastMeasurement,
  parseRadnetCsv,
} from '../../src/layers/radiation/records.js';
import { readResponseTextCapped } from './common/http.js';

/**
 * EPA RadNet + Safecast radiation proxy.
 *
 * Upstreams (all keyless):
 *   GET https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2026/fixed/nj/edison
 *   GET https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2026/fixed/pa/philadelphia
 *   GET https://api.safecast.org/measurements.json?latitude=39.08&longitude=-74.88&distance=200000
 *
 * Verified live 2026-11-16: Edison 39 nSv/h at 21:42 UTC (6,900 rows
 * YTD), Philadelphia 41 nSv/h at 21:39 UTC — both APPROVED, hourly.
 * Safecast's nearest rows within 200 km are 2017 Maryland measurements
 * (17–26 cpm): a supplement only, never the headline. ⚠️ Safecast's
 * `distance` parameter is in METERS.
 *
 * The CDX year segment rolls yearly — the provider uses the current
 * year and falls back to the previous year in early January before the
 * new file exists. The old Envirofacts efservice path is dead (301 →
 * 404); do not use it. Readings are hourly; the proxy caches 60
 * minutes. On upstream failure serve the last cached readings with
 * their sample timestamps, labeled stale.
 *
 * Routes:
 *   GET /api/radiation        → {fetchedAt, stale, ttlMs, monitors, safecast}
 *   GET /api/radiation/status → {lastFetch, stale, ttlMs, monitors}
 *
 * @returns {import('vite').Plugin}
 */

export const RADIATION_PROXY_TTL_MS = 60 * 60 * 1000;
export const RADIATION_PROXY_TIMEOUT_MS = 20_000;
export const RADIATION_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const RADIATION_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RADIATION_BACKOFF_MS = 60_000;

export function radiationProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, monitors: Array, safecast: ?object}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  function monitorYear() {
    return new Date(now()).getUTCFullYear();
  }

  async function fetchMonitorText(monitor, signal) {
    const years = [monitorYear(), monitorYear() - 1];
    let lastError = null;
    for (const year of years) {
      const path = monitor.path.replace(/^\d{4}\//, `${year}/`);
      try {
        const res = await fetchImpl(`${RADNET_CDX_BASE}/${path}`, {
          signal,
          headers: {
            Accept: 'text/csv',
            'User-Agent': RADIATION_PROXY_USER_AGENT,
          },
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          throw new Error(`HTTP ${res.status} for ${monitor.key}`);
        }
        return await readResponseTextCapped(
          res,
          RADIATION_MAX_RESPONSE_BYTES,
          signal,
        );
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error(`RadNet fetch failed for ${monitor.key}`);
  }

  async function fetchSafecast(signal) {
    try {
      const url =
        `${SAFECAST_URL}?latitude=${COUNTY_SEAT.lat}` +
        `&longitude=${COUNTY_SEAT.lon}&distance=${SAFECAST_SEARCH_RADIUS_M}&limit=5`;
      const res = await fetchImpl(url, {
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': RADIATION_PROXY_USER_AGENT,
        },
      });
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows)) return null;
      let nearest = null;
      let nearestKm = Infinity;
      for (const row of rows) {
        const measurement = normalizeSafecastMeasurement(row);
        if (!measurement) continue;
        const km = distanceKm(COUNTY_SEAT, measurement);
        if (km != null && km < nearestKm) {
          nearestKm = km;
          nearest = { ...measurement, distanceKm: Math.round(km) };
        }
      }
      return nearest;
    } catch {
      return null;
    }
  }

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(RADIATION_PROXY_TIMEOUT_MS);
    const [safecast, ...csvTexts] = await Promise.all([
      fetchSafecast(signal),
      ...RADNET_MONITORS.map((monitor) =>
        fetchMonitorText(monitor, signal).catch(() => null),
      ),
    ]);
    const monitors = [];
    RADNET_MONITORS.forEach((monitor, i) => {
      const parsed = csvTexts[i] ? parseRadnetCsv(csvTexts[i]) : null;
      if (!parsed) return;
      monitors.push({
        key: monitor.key,
        name: monitor.name,
        state: monitor.state,
        lat: monitor.lat,
        lon: monitor.lon,
        distanceKm: Math.round(distanceKm(COUNTY_SEAT, monitor) ?? 0),
        doseRateNSvH: parsed.doseRateNSvH,
        gammaCpmR02: parsed.gammaCpmR02,
        sampleTime: parsed.sampleTime,
        status: parsed.status,
      });
    });
    // Nearest monitor first.
    monitors.sort((a, b) => a.distanceKm - b.distanceKm);
    if (monitors.length === 0)
      throw new Error('No RadNet monitor returned a reading');
    return { at: now(), monitors, safecast };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: RADIATION_PROXY_TTL_MS,
      monitors: entry.monitors,
      safecast: entry.safecast,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/radiation', async (req, res) => {
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
            stale: mem ? now() - mem.at >= RADIATION_PROXY_TTL_MS : false,
            ttlMs: RADIATION_PROXY_TTL_MS,
            monitors: mem
              ? mem.monitors.map((m) => `${m.name} ${m.doseRateNSvH} nSv/h`)
              : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < RADIATION_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'RadNet fetch failed and no cache available',
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
              backoffUntil = now() + RADIATION_BACKOFF_MS;
              lastFailure = null;
              warn(
                `[radiation-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'RadNet fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[radiation-proxy] error:', err?.message || err);
        sendJson(500, { error: 'radiation proxy error' });
      }
    });
  };
  return {
    name: 'radiation-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
