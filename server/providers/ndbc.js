// NOAA NDBC marine buoys for the cape-buoys layer — realtime2 text files.
// Port of the old app's app/buoys.py (same stations, same header-driven
// column parse, same payload shape so src/layers/capeDispatch/model.js
// mapBuoys() works unchanged). Keyless: NDBC publishes a plain-text
// realtime2 file per station with the latest ~45 days of observations.
//
//   - 44009  Delaware Bay, ~26 nm SE of Cape May Point — open-water wave
//            height/period, wind, water temperature. Reports hourly.
//   - CMAN4  Cape May Point, NJ — coastal wind, pressure, air temperature.
//            No wave sensor, so wave fields are absent. The realtime2
//            filename is UPPERCASE; "cman4.txt" is a 404.
//
// The column layout is read from the file's own header line rather than
// hardcoded indices, since NDBC has changed column sets across stations
// and over time. Missing values are reported by NDBC as "MM" and mapped
// to null.
import { readResponseTextCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

export const NDBC_URL =
  'https://www.ndbc.noaa.gov/data/realtime2/{station}.txt';

export const NDBC_STATIONS = Object.freeze({
  44009: Object.freeze({
    name: 'Delaware Bay',
    kind: 'offshore buoy',
    lat: 38.457,
    lng: -74.702,
  }),
  cman4: Object.freeze({
    name: 'Cape May Point, NJ',
    kind: 'coastal station',
    lat: 38.968,
    lng: -74.96,
  }),
});

const CACHE_MS = 900_000; // 15 minutes; buoys report hourly
const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;

function num(value) {
  if (value == null || value === 'MM') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Most recent row of an NDBC realtime2 file, or null when unparseable. */
export function parseRealtime2(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return null;
  const header = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const rows = lines.slice(1).filter((line) => !line.startsWith('#'));
  if (!rows.length) return null;
  const cols = rows[0].trim().split(/\s+/);
  const fields = Object.fromEntries(
    header.slice(0, cols.length).map((key, i) => [key, cols[i]]),
  );
  let observedAt = null;
  try {
    const year = Number(fields.YY);
    const month = Number(fields.MM);
    const day = Number(fields.DD);
    const hour = Number(fields.hh);
    const minute = Number(fields.mm);
    if ([year, month, day, hour, minute].every(Number.isFinite)) {
      observedAt = new Date(
        Date.UTC(year, month - 1, day, hour, minute),
      ).toISOString();
    }
  } catch {
    observedAt = null;
  }
  return {
    observed_at: observedAt,
    wind_dir_deg: num(fields.WDIR),
    wind_speed_ms: num(fields.WSPD),
    gust_ms: num(fields.GST),
    wave_height_m: num(fields.WVHT),
    dominant_wave_period_s: num(fields.DPD),
    pressure_hpa: num(fields.PRES),
    air_temp_c: num(fields.ATMP),
    water_temp_c: num(fields.WTMP),
  };
}

export function ndbcStationUrl(station) {
  return NDBC_URL.replace('{station}', String(station).toUpperCase());
}

async function fetchStation(fetchImpl, station) {
  const meta = NDBC_STATIONS[station];
  const out = { station, ...meta, error: null };
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(ndbcStationUrl(station), { signal });
    if (!response.ok) throw new Error(`ndbc_upstream_${response.status}`);
    const { tooLarge, text } = await readResponseTextCapped(
      response,
      MAX_RESPONSE_BYTES,
      signal,
    );
    if (tooLarge) throw new Error('ndbc_response_too_large');
    const parsed = parseRealtime2(text);
    if (!parsed) out.error = 'no data rows';
    else Object.assign(out, parsed);
  } catch (error) {
    out.error = String(error?.message || error);
  }
  return out;
}

export function ndbcProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load() {
    const stations = {};
    const results = await Promise.all(
      Object.keys(NDBC_STATIONS).map((station) =>
        fetchStation(fetchImpl, station),
      ),
    );
    for (const result of results) stations[result.station] = result;
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
        age_s: Math.floor((t - cache.fetched_at) / 1000),
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
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    } catch (error) {
      if (cache) {
        return json(200, {
          stations: cache.stations,
          age_s: Math.floor((t - cache.fetched_at) / 1000),
          stale: true,
        });
      }
      return json(502, {
        error: 'ndbc_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'ndbc-buoys',
    configureServer({ middlewares }) {
      middlewares.use('/api/ndbc', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/ndbc', handler);
    },
  };
}
