// NWS wind observations for the cape-wind layer — api.weather.gov latest
// observations at local ASOS stations. Port of the old app's
// app/wx_layers.py wind half (same stations, same km/h -> mph conversion,
// same payload shape so src/layers/capeDispatch/model.js mapWind() works
// unchanged). Keyless; User-Agent identifies the app, as NWS requests.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const NWS_OBS = 'https://api.weather.gov/stations/{sid}/observations/latest';
const USER_AGENT = 'CapeDispatch/1.0 (capemaydispatch.com)';

export const WIND_STATIONS = Object.freeze([
  Object.freeze({
    id: 'KWWD',
    name: 'Cape May Co. Airport',
    lat: 39.0085,
    lng: -74.9083,
  }),
  Object.freeze({
    id: 'KACY',
    name: 'Atlantic City Airport',
    lat: 39.4576,
    lng: -74.5772,
  }),
  Object.freeze({
    id: 'KMIV',
    name: 'Millville Airport',
    lat: 39.3678,
    lng: -75.0722,
  }),
  Object.freeze({
    id: 'KOBI',
    name: 'Woodbine Airport',
    lat: 39.2192,
    lng: -74.7947,
  }),
]);

const KMH_TO_MPH = 0.621371;
const CACHE_MS = 600_000; // 10 minutes, like the old WIND_TTL
const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * One NWS latest-observation body -> the wind station shape mapWind()
 * consumes. Null when the observation carries no wind speed (a calm or
 * incomplete report) — the caller keeps the station's last good reading
 * marked stale instead.
 */
export function parseWindObservation(station, body) {
  const p = body?.properties || {};
  const speed = p.windSpeed?.value;
  if (speed == null) return null;
  const gust = p.windGust?.value;
  return {
    ...station,
    mph: Math.round(Number(speed) * KMH_TO_MPH),
    gust_mph: gust != null ? Math.round(Number(gust) * KMH_TO_MPH) : null,
    dir_deg: p.windDirection?.value ?? null,
    time: p.timestamp || null,
  };
}

export function nwsWindUrl(stationId) {
  return NWS_OBS.replace('{sid}', stationId);
}

export function nwsWindProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function fetchStation(station, previous) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const response = await fetchImpl(nwsWindUrl(station.id), {
        signal,
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`nws_upstream_${response.status}`);
      const body = await readResponseJsonCapped(
        response,
        MAX_RESPONSE_BYTES,
        signal,
      );
      const parsed = parseWindObservation(station, body);
      if (parsed) return parsed;
      throw new Error('no wind speed in observation');
    } catch {
      // Fail soft: keep the last good reading, marked stale.
      if (previous) return { ...previous, stale: true };
      return null;
    }
  }

  async function load() {
    const previous = new Map(
      (cache?.stations || []).map((station) => [station.id, station]),
    );
    const stations = (
      await Promise.all(
        WIND_STATIONS.map((station) =>
          fetchStation(station, previous.get(station.id)),
        ),
      )
    ).filter(Boolean);
    return { stations, fetched_at: now() };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) {
      return json(200, {
        stations: cache.stations,
        updated:
          cache.stations
            .map((s) => s.time || '')
            .sort()
            .at(-1) || null,
        attribution: 'NWS observations',
      });
    }
    try {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, {
        stations: cache.stations,
        updated:
          cache.stations
            .map((s) => s.time || '')
            .sort()
            .at(-1) || null,
        attribution: 'NWS observations',
      });
    } catch (error) {
      if (cache) {
        return json(200, {
          stations: cache.stations,
          updated: null,
          attribution: 'NWS observations',
          stale: true,
        });
      }
      return json(502, {
        error: 'nws_wind_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'nws-wind',
    configureServer({ middlewares }) {
      middlewares.use('/api/nws-wind', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/nws-wind', handler);
    },
  };
}
