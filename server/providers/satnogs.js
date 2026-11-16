import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { SATNOGS_STATIONS } from '../../src/layers/satnogs/stations.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * SatNOGS satellite-observations proxy.
 *
 * Upstream: the SatNOGS Network observations API (free, keyless,
 * CC BY-SA 4.0) —
 *   https://network.satnogs.org/api/observations/?ground_station=<id>&status=<good|future>&start=…&end=…
 * plus the SatNOGS DB satellite-identity API (free, keyless) —
 *   https://db.satnogs.org/api/satellites/?norad_cat_id=<id>
 *
 * Neither API sends CORS headers (verified 2026-11-16: 200 with no
 * Access-Control-Allow-Origin, even with an Origin header), so the
 * browser can never fetch them directly — hence this same-origin proxy.
 * Observation media need no proxy: waterfall PNGs (Wasabi S3) and audio
 * OGGs (Fastly) are plain <img>/<audio>/link-outs.
 *
 * The proxy fetches, per allowlisted station (see
 * src/layers/satnogs/stations.js), the trailing-7-day `good`
 * observations and the next-48-hour `future` observations, following the
 * API's cursor pagination (`Link: <…?cursor=…>; rel="next"`, 25 rows per
 * page). It trims each observation to the fields the layer renders —
 * the TLE fields (tle0/1/2) are dropped here and never reach the client:
 * this layer ingests no TLEs and predicts no passes — and resolves
 * satellite names through the DB API (observation records carry only a
 * NORAD id). Names are cached on disk keyed by NORAD id, so the DB is
 * only hit for satellites never seen before.
 *
 * Rate budget (anonymous observations list: 60/hr, 429 with
 * {"detail":"Request was throttled…"}): 20-min TTL, at most 6 good
 * pages + 2 future pages per station. Live volumes measured 2026-11-16
 * (first live refresh: 183 observations — 116 good + 29 future from
 * the anchor station, 26 + 7 from ka6akh, 5 future from KC3QNJ, none
 * from Alx2): a refresh costs ~14 observations requests (~42/hr) plus
 * one DB lookup per previously-unseen satellite (22 on the first live
 * refresh; names are cached on disk, so steady-state refreshes add only
 * a few). Inside the budget with headroom. One station down does not
 * sink the others: a partial refresh still produces a cacheable entry
 * with the failed station marked ok:false.
 *
 * Cache: 20-min TTL, single-flight refresh, serve-stale-on-failure, and
 * a disk cache (.gev-cache/satnogs.json) so a restart does not re-hit
 * the upstream. Pattern mirrors marineWarningsProxy.
 *
 * Routes:
 *   GET /api/satnogs        → {fetchedAt, stale, ttlMs, stations, count, observations}
 *   GET /api/satnogs/status → {lastFetch, count, stale, ttlMs, stations}
 *
 * @returns {import('vite').Plugin}
 */

export const SATNOGS_PROXY_TTL_MS = 20 * 60_000;
export const SATNOGS_PROXY_TIMEOUT_MS = 10_000;
export const SATNOGS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const SATNOGS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** At most 6 pages (150 rows) of completed observations per station. */
export const SATNOGS_MAX_GOOD_PAGES = 6;
/** At most 2 pages (50 rows) of scheduled observations per station. */
export const SATNOGS_MAX_FUTURE_PAGES = 2;

export const SATNOGS_OBSERVATIONS_API =
  'https://network.satnogs.org/api/observations/';
export const SATNOGS_DB_API = 'https://db.satnogs.org/api/satellites/';

/** The `?cursor=` URL of the next page, or null when there is none. */
export function nextPageUrl(linkHeader) {
  if (typeof linkHeader !== 'string' || linkHeader === '') return null;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]*)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return null;
}

/**
 * Trim one raw observation to the fields the layer renders. Drops the
 * TLE fields (tle0/1/2), client metadata, and the demoddata frame list
 * (kept as a count) — none of those reach the client. Never throws.
 */
export function trimSatnogsObservation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const demoddata = Array.isArray(raw.demoddata) ? raw.demoddata : [];
  return {
    id,
    start: typeof raw.start === 'string' ? raw.start : null,
    end: typeof raw.end === 'string' ? raw.end : null,
    ground_station: Number(raw.ground_station),
    norad_cat_id: Number(raw.norad_cat_id),
    satellite_name: null, // resolved from the DB below, when known
    status: typeof raw.status === 'string' ? raw.status : null,
    vetted_status:
      typeof raw.vetted_status === 'string' ? raw.vetted_status : null,
    waterfall: typeof raw.waterfall === 'string' ? raw.waterfall : null,
    payload: typeof raw.payload === 'string' ? raw.payload : null,
    demod_count: demoddata.length,
    transmitter_description:
      typeof raw.transmitter_description === 'string'
        ? raw.transmitter_description
        : null,
    transmitter_mode:
      typeof raw.transmitter_mode === 'string'
        ? raw.transmitter_mode
        : null,
    transmitter_downlink_low: Number(raw.transmitter_downlink_low) || null,
    transmitter_downlink_high: Number(raw.transmitter_downlink_high) || null,
    observation_frequency: Number(raw.observation_frequency) || null,
    max_altitude: Number(raw.max_altitude) || null,
    rise_azimuth: Number(raw.rise_azimuth) || null,
    set_azimuth: Number(raw.set_azimuth) || null,
    station_name:
      typeof raw.station_name === 'string' ? raw.station_name : null,
    station_lat: Number(raw.station_lat) || null,
    station_lng: Number(raw.station_lng) || null,
  };
}

export function satnogsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
} = {}) {
  const TTL_MS = SATNOGS_PROXY_TTL_MS;
  const CACHE_DIR = cacheDir;
  const CACHE_PATH = path.join(CACHE_DIR, 'satnogs.json');

  /** @type {?{at: number, stations: Array<object>, observations: Array<object>, names: object}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise} single-flight refresh */
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (
        Number.isFinite(parsed?.at) &&
        Array.isArray(parsed?.stations) &&
        Array.isArray(parsed?.observations) &&
        parsed?.names &&
        typeof parsed.names === 'object'
      ) {
        mem = {
          at: parsed.at,
          stations: parsed.stations,
          observations: parsed.observations,
          names: parsed.names,
        };
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      warn('[satnogs-proxy] cache write failed:', err?.message || err);
    }
  }

  /** Fetch one JSON page. Throws on HTTP error or oversize. */
  async function fetchJsonPage(url) {
    const signal = AbortSignal.timeout(SATNOGS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': SATNOGS_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let payload;
    try {
      payload = await readResponseJsonCapped(
        res,
        SATNOGS_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    return { payload, link: res.headers?.get?.('link') ?? null };
  }

  /**
   * Fetch one station's observations for one status, following cursor
   * pages up to `maxPages`. Returns the trimmed rows (possibly []).
   */
  async function fetchStationObservations(stationId, status, window, maxPages) {
    const params = new URLSearchParams({
      ground_station: String(stationId),
      status,
      start: window.start,
      end: window.end,
    });
    let url = `${SATNOGS_OBSERVATIONS_API}?${params}`;
    const rows = [];
    for (let page = 0; page < maxPages; page++) {
      const { payload, link } = await fetchJsonPage(url);
      if (!Array.isArray(payload))
        throw new Error('non-list observations response');
      for (const raw of payload) {
        const trimmed = trimSatnogsObservation(raw);
        if (trimmed) rows.push(trimmed);
      }
      const next = nextPageUrl(link);
      if (!next) break;
      url = next;
    }
    return rows;
  }

  /** Resolve satellite names for NORAD ids not already in `knownNames`. */
  async function resolveNames(noradIds, knownNames) {
    const names = { ...knownNames };
    const missing = [...new Set(noradIds)].filter(
      (id) => Number.isInteger(id) && id > 0 && names[id] == null,
    );
    for (const id of missing) {
      try {
        const { payload } = await fetchJsonPage(
          `${SATNOGS_DB_API}?norad_cat_id=${id}`,
        );
        const name =
          Array.isArray(payload) && payload.length > 0
            ? payload[0]?.name
            : null;
        names[id] = typeof name === 'string' && name.trim() ? name : null;
      } catch (err) {
        warn(
          `[satnogs-proxy] satellite name lookup failed for NORAD ${id}:`,
          err?.message || err,
        );
        names[id] = null; // do not retry every refresh within this cache
      }
    }
    return names;
  }

  /**
   * Refresh all stations. Partial success (≥1 station ok) still
   * produces a cacheable entry with failed stations marked ok:false;
   * total failure throws so the caller can serve stale.
   */
  async function refreshUpstream() {
    const started = now();
    const start = new Date(started - 7 * 24 * 60 * 60_000).toISOString();
    const end = new Date(started).toISOString();
    const futureEnd = new Date(
      started + 48 * 60 * 60_000,
    ).toISOString();
    const settled = await Promise.allSettled(
      SATNOGS_STATIONS.map(async (station) => {
        const good = await fetchStationObservations(
          station.id,
          'good',
          { start, end },
          SATNOGS_MAX_GOOD_PAGES,
        );
        const future = await fetchStationObservations(
          station.id,
          'future',
          { start: end, end: futureEnd },
          SATNOGS_MAX_FUTURE_PAGES,
        );
        return { station, rows: [...good, ...future] };
      }),
    );
    const stations = [];
    const observations = [];
    for (const [index, result] of settled.entries()) {
      const station = SATNOGS_STATIONS[index];
      if (result.status === 'fulfilled') {
        for (const row of result.value.rows) observations.push(row);
        stations.push({
          id: station.id,
          name: station.name,
          lat: station.lat,
          lon: station.lon,
          distanceKm: station.distanceKm,
          observations: station.observations,
          successRate: station.successRate,
          count: result.value.rows.length,
          ok: true,
        });
      } else {
        warn(
          `[satnogs-proxy] station ${station.id} fetch failed:`,
          result.reason?.message || result.reason,
        );
        stations.push({
          id: station.id,
          name: station.name,
          lat: station.lat,
          lon: station.lon,
          distanceKm: station.distanceKm,
          observations: station.observations,
          successRate: station.successRate,
          count: 0,
          ok: false,
        });
      }
    }
    if (!stations.some((s) => s.ok))
      throw new Error('all SatNOGS stations failed');
    const names = await resolveNames(
      observations.map((row) => row.norad_cat_id),
      mem?.names ?? {},
    );
    for (const row of observations) {
      row.satellite_name = names[row.norad_cat_id] ?? null;
    }
    return { at: started, stations, observations, names };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      stations: entry.stations,
      count: entry.observations.length,
      observations: entry.observations,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/satnogs', async (req, res) => {
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
        await readDiskOnce();

        if (subPath === '/status') {
          sendJson(200, {
            lastFetch: mem ? mem.at : null,
            count: mem ? mem.observations.length : null,
            stale: mem ? now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            stations: mem ? mem.stations : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream()
            .then(async (fresh) => {
              mem = fresh;
              await writeDisk(mem);
              return mem;
            })
            .catch((err) => {
              warn(
                `[satnogs-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: 'SatNOGS fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[satnogs-proxy] error:', err?.message || err);
        sendJson(500, { error: 'SatNOGS proxy error' });
      }
    });
  };
  return {
    name: 'satnogs-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
