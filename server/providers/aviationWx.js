// Local airport weather (METAR/TAF flight-category) for the cape-airports
// layer — aviationweather.gov Data API, keyless. Port of the old app's
// app/airport_wx.py (same airports, same FAA flight-category computation,
// same payload shape so src/layers/capeDispatch/model.js mapAirports()
// works unchanged).
//
// Covers three airports that actually have weather stations:
//   - KACY  Atlantic City International
//   - KMIV  Millville Executive
//   - KWWD  Cape May County Airport (Wildwood)
// Ocean City Municipal has no ASOS/AWOS and is deliberately left out
// rather than shown as a permanently "unavailable" station.
//
// Flight category (VFR/MVFR/IFR/LIFR) comes straight from the API when
// present. When the API omits it — it sometimes does for a station with
// an incomplete observation — it is computed from ceiling and visibility
// using the same FAA thresholds pilots use:
//   LIFR:  ceiling <500 ft  or visibility <1 sm
//   IFR:   ceiling <1000 ft or visibility <3 sm
//   MVFR:  ceiling <3000 ft or visibility <=5 sm
//   VFR:   everything else
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const METAR_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_URL = 'https://aviationweather.gov/api/data/taf';

// Every reporting station in this box (lat0,lon0,lat1,lon1), not just the
// three above: about 60 nm around the county, Philadelphia to Salisbury.
const REGION_BBOX = '38.3,-76.0,40.2,-73.8';

export const AIRPORTS = Object.freeze({
  KACY: Object.freeze({
    name: 'Atlantic City Intl',
    lat: 39.4576,
    lng: -74.5772,
  }),
  KMIV: Object.freeze({
    name: 'Millville Executive',
    lat: 39.3698,
    lng: -75.077,
  }),
  KWWD: Object.freeze({
    name: 'Cape May County Airport',
    lat: 39.0021,
    lng: -74.9082,
  }),
});

const CAT_COLOR = Object.freeze({
  VFR: '#22c55e',
  MVFR: '#3b82f6',
  IFR: '#ef4444',
  LIFR: '#e879f9',
});

const CACHE_MS = 600_000; // 10 minutes; METARs post roughly hourly
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * Parse the API's visibility field, which may be a number, a plain
 * string like '10+', or a fraction like '1/2' or '1 1/4'.
 */
export function parseVisibility(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().replace(/\+$/, '');
  const plain = Number(s);
  if (Number.isFinite(plain)) return plain;
  const parts = s.split(/\s+/);
  try {
    let result = null;
    if (parts.length === 2) {
      const [num, den] = parts[1].split('/');
      result = Number(parts[0]) + Number(num) / Number(den);
    } else if (s.includes('/')) {
      const [num, den] = s.split('/');
      result = Number(num) / Number(den);
    }
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
  return null;
}

/**
 * Lowest broken/overcast/obscured layer, which is what defines a
 * ceiling. FEW/SCT layers don't count — the sky isn't considered
 * covered until BKN or worse.
 */
export function ceilingFeet(clouds) {
  if (!Array.isArray(clouds)) return null;
  const bases = clouds
    .filter((c) => ['BKN', 'OVC', 'OVX'].includes(c?.cover) && c?.base != null)
    .map((c) => c.base);
  return bases.length ? Math.min(...bases) : null;
}

export function classifyFlightCategory(fltCat, ceilingFt, visibSm) {
  if (['VFR', 'MVFR', 'IFR', 'LIFR'].includes(fltCat)) return fltCat;
  // API didn't compute one (incomplete observation) — derive it from
  // what we do have, rather than leaving the dot uncolored.
  if (ceilingFt == null && visibSm == null) return null;
  const ceil = ceilingFt != null ? ceilingFt : 99999;
  const vis = visibSm != null ? visibSm : 99.0;
  if (ceil < 500 || vis < 1) return 'LIFR';
  if (ceil < 1000 || vis < 3) return 'IFR';
  if (ceil < 3000 || vis <= 5) return 'MVFR';
  return 'VFR';
}

export function categoryColor(category) {
  return CAT_COLOR[category] || '#94a3b8';
}

/** One METAR row -> the airport payload shape mapAirports() consumes. */
export function mapMetarRow(row) {
  const icao = row?.icaoId;
  const meta = AIRPORTS[icao];
  const name =
    meta?.name ||
    (icao && row?.lat != null
      ? String(row?.name || icao)
          .split(',')[0]
          .trim()
      : null);
  if (!icao || !name) return null;
  const clouds = row?.clouds || [];
  const ceiling = ceilingFeet(clouds);
  const visib = parseVisibility(row?.visib);
  const category = classifyFlightCategory(row?.fltCat, ceiling, visib);
  return {
    icao,
    name,
    lat: meta?.lat ?? row?.lat,
    lng: meta?.lng ?? row?.lon,
    flight_category: category,
    color: categoryColor(category),
    temp_c: row?.temp ?? null,
    dewpoint_c: row?.dewp ?? null,
    wind_dir_deg: row?.wdir ?? null,
    wind_speed_kt: row?.wspd ?? null,
    wind_gust_kt: row?.wgst ?? null,
    visibility_sm: visib,
    ceiling_ft: ceiling,
    altimeter_inhg: row?.altim ?? null,
    raw: row?.rawOb ?? null,
    observed_at: row?.reportTime || row?.obsTime || null,
    error: null,
  };
}

/** Raw TAF text only — decoding forecast periods is a lot of format for a popup. */
export function mapTafRows(rows) {
  const out = {};
  for (const row of rows || []) {
    const icao = row?.icaoId;
    const raw = row?.rawTAF || row?.rawOb;
    if (icao && raw) out[icao] = String(raw).replace(/\s+/g, ' ').trim();
  }
  return out;
}

async function fetchJson(fetchImpl, url) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetchImpl(
    `${url}?bbox=${encodeURIComponent(REGION_BBOX)}&format=json`,
    { signal },
  );
  if (!response.ok) throw new Error(`aviationwx_upstream_${response.status}`);
  return readResponseJsonCapped(response, MAX_RESPONSE_BYTES, signal);
}

export function aviationWxProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load() {
    const [metars, tafs] = await Promise.all([
      fetchJson(fetchImpl, METAR_URL).catch(() => null),
      fetchJson(fetchImpl, TAF_URL).catch(() => null),
    ]);
    const airports = {};
    const metarByIcao = {};
    for (const row of metars || []) {
      const mapped = mapMetarRow(row);
      if (mapped) metarByIcao[mapped.icao] = mapped;
    }
    const tafByIcao = mapTafRows(tafs);
    // The three county-area fields always appear (greyed if silent);
    // every other station in the region appears while it reports.
    const ids = [
      ...Object.keys(AIRPORTS),
      ...Object.keys(metarByIcao)
        .filter((icao) => !AIRPORTS[icao])
        .sort(),
    ];
    for (const icao of ids) {
      const entry = metarByIcao[icao] || {
        icao,
        ...AIRPORTS[icao],
        flight_category: null,
        color: '#94a3b8',
        error: 'no observation',
      };
      entry.taf_raw = tafByIcao[icao] ?? null;
      airports[icao] = entry;
    }
    return { airports, fetched_at: now() };
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
        airports: cache.airports,
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
        airports: cache.airports,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    } catch (error) {
      if (cache) {
        return json(200, {
          airports: cache.airports,
          age_s: Math.floor((t - cache.fetched_at) / 1000),
          stale: true,
        });
      }
      return json(502, {
        error: 'aviationwx_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'aviation-weather',
    configureServer({ middlewares }) {
      middlewares.use('/api/airport-wx', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/airport-wx', handler);
    },
  };
}
