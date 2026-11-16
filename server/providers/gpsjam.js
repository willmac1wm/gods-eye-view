import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
import { readResponseTextCapped } from './common/http.js';

/**
 * GPSJam daily GNSS-interference proxy.
 *
 * Upstream: gpsjam.org publishes one CSV per UTC day —
 *   https://gpsjam.org/data/manifest.csv
 *   https://gpsjam.org/data/YYYY-MM-DD-h3_4.csv
 * Columns: `hex,count_good_aircraft,count_bad_aircraft`, where `hex` is an
 * H3 resolution-4 index. The manifest also carries a `suspect` flag per
 * day (gpsjam.org flags dates with incomplete collection) and a `source`
 * column (`adsbexchange` through 2026-08-26, `merged` from 2026-08-27 —
 * the data comes from airplanes.live + ADS-B Exchange, deduped per
 * aircraft). A day that is not published yet returns HTTP 404 (verified
 * 2026-11-16: 2026-11-16 404s while 2026-11-15 is live), so the proxy
 * tries yesterday-UTC first and falls back to the day before.
 *
 * gpsjam.org sends NO CORS headers (verified 2026-11-16 with an Origin
 * header), so the browser can never fetch these files directly — hence
 * this same-origin proxy, mirroring the firms pattern.
 *
 * The world file is ~48k rows / ~1 MB. H3 res-4 cells are huge (avg
 * 1,770 km², ~26 km edge), so the proxy filters server-side to the
 * county box (lat 38.9–39.35, lon −75.15–−74.55) plus a 0.5° margin,
 * by cell centroid, and ships each surviving cell's centroid + 6
 * boundary vertices. The browser never sees the world file — it gets
 * ~13 cells, a few KB. Green cells are kept: with 13 cells there is no
 * clutter, and hiding them would confuse "all clear" with "no data".
 *
 * Levels use gpsjam.org's published formula and bands (see the
 * [GPSJAM FAQ](https://gpsjam.org/faq)): score =
 * `100 × max(0, bad − 1) / total`, under 2% low, 2–10% medium, over
 * 10% high; cells with fewer than 3 aircraft are dropped.
 *
 * Licence: gpsjam.org's own pages state NO licence (checked live
 * 2026-11-16: FAQ, About and home carry no licence text). Downstream
 * users assert CC-BY 4.0, but that is NOT claimed here — the credit is
 * "Data: gpsjam.org (John Wiseman / ADS-B Exchange)" with no licence
 * label. Do not add a CC-BY claim without verifying it from a primary
 * source.
 *
 * Cache: 6-hour TTL, single-flight refresh, serve-stale-on-failure, and
 * a disk cache (.gev-cache/gpsjam.json) so a restart does not re-hit
 * the upstream.
 *
 * Routes:
 *   GET /api/gpsjam        → {date, source, suspect, fetchedAt, stale, ttlMs, worldRows, count, cells}
 *   GET /api/gpsjam/status → {lastFetch, date, count, stale, ttlMs}
 *
 * @returns {import('vite').Plugin}
 */

export const GPSJAM_PROXY_TTL_MS = 6 * 60 * 60_000;
export const GPSJAM_PROXY_TIMEOUT_MS = 30_000;
export const GPSJAM_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const GPSJAM_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const GPSJAM_BASE_URL = 'https://gpsjam.org/data';

/** Cape May County box the layer covers. */
export const GPSJAM_BOX = Object.freeze({
  latMin: 38.9,
  latMax: 39.35,
  lonMin: -75.15,
  lonMax: -74.55,
});
/** Margin around the county box, in degrees — res-4 cells are ~26 km across. */
export const GPSJAM_MARGIN_DEG = 0.5;
/** Hide sparse one- and two-aircraft cells; the score separately discounts one bad report. */
export const GPSJAM_MIN_AIRCRAFT = 3;
/** gpsjam.org band edges, in percent of aircraft (after discounting one). */
export const GPSJAM_MEDIUM_PERCENT = 2;
export const GPSJAM_HIGH_PERCENT = 10;

const HEX_PATTERN = /^[0-9a-f]{15}$/;

function formatUtcDate(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Candidate data dates, newest first: yesterday UTC, then the day
 * before (yesterday's file may not be published yet — it lands soon
 * after midnight UTC — and a 404 falls back to the prior day).
 * Never throws.
 */
export function gpsjamCandidateDates(nowMs = Date.now()) {
  const today = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
  const dayMs = 24 * 60 * 60_000;
  return [formatUtcDate(today - dayMs), formatUtcDate(today - 2 * dayMs)];
}

/**
 * Parse the manifest CSV into a Map of date → { suspect, source }.
 * Header: `date,suspect,num_bad_aircraft_hexes,source`. Malformed
 * lines are skipped; a non-string or headerless body yields an empty
 * map. Never throws.
 */
export function parseGpsjamManifest(text) {
  const out = new Map();
  if (typeof text !== 'string' || text === '') return out;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('date,')) continue;
    const [date, suspect, , source] = trimmed.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue;
    out.set(date, {
      suspect: suspect === 'true',
      source: typeof source === 'string' && source !== '' ? source : null,
    });
  }
  return out;
}

/**
 * gpsjam.org cell level for a cell's aircraft counts: the first bad
 * aircraft is discounted to limit false positives, then under 2% is
 * low, 2–10% medium and over 10% high.
 */
export function gpsjamLevel(total, bad) {
  const percent = total > 0 ? (100 * Math.max(0, bad - 1)) / total : 0;
  const level =
    percent > GPSJAM_HIGH_PERCENT
      ? 'high'
      : percent >= GPSJAM_MEDIUM_PERCENT
        ? 'medium'
        : 'low';
  return { percent: Math.round(percent * 10) / 10, level };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Parse one daily CSV into the county cells the client draws.
 * Returns `{ worldRows, droppedRows, cells }`; `cells` are centroid
 * + boundary (GeoJSON [lon, lat] pairs, 6 vertices — the closing
 * duplicate h3-js returns is stripped) for cells whose centroid falls
 * in the county box + margin and which saw at least 3 aircraft.
 * Malformed lines are counted in `droppedRows`, never fatal. Never
 * throws on malformed input.
 */
export function parseGpsjamCsv(text) {
  const cells = [];
  let worldRows = 0;
  let droppedRows = 0;
  if (typeof text !== 'string' || text === '')
    return { worldRows, droppedRows, cells };
  const latMin = GPSJAM_BOX.latMin - GPSJAM_MARGIN_DEG;
  const latMax = GPSJAM_BOX.latMax + GPSJAM_MARGIN_DEG;
  const lonMin = GPSJAM_BOX.lonMin - GPSJAM_MARGIN_DEG;
  const lonMax = GPSJAM_BOX.lonMax + GPSJAM_MARGIN_DEG;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('hex,')) continue;
    worldRows += 1;
    const [hex, goodRaw, badRaw] = trimmed.split(',');
    const good = Number(goodRaw);
    const bad = Number(badRaw);
    if (
      typeof hex !== 'string' ||
      !HEX_PATTERN.test(hex) ||
      !isValidCell(hex) ||
      !Number.isInteger(good) ||
      !Number.isInteger(bad) ||
      good < 0 ||
      bad < 0
    ) {
      droppedRows += 1;
      continue;
    }
    const total = good + bad;
    if (total < GPSJAM_MIN_AIRCRAFT) continue;
    let lat;
    let lon;
    let boundary;
    try {
      [lat, lon] = cellToLatLng(hex);
      boundary = cellToBoundary(hex, true);
    } catch {
      droppedRows += 1;
      continue;
    }
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !Array.isArray(boundary) ||
      boundary.length < 3
    ) {
      droppedRows += 1;
      continue;
    }
    if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) continue;
    const vertices = boundary
      .map((point) => {
        if (!Array.isArray(point) || point.length < 2) return null;
        const [boundaryLon, boundaryLat] = point;
        if (!Number.isFinite(boundaryLon) || !Number.isFinite(boundaryLat))
          return null;
        return [round6(boundaryLon), round6(boundaryLat)];
      })
      .filter(Boolean);
    // h3-js closes the ring by repeating the first vertex; drop it.
    if (
      vertices.length > 1 &&
      vertices[0][0] === vertices[vertices.length - 1][0] &&
      vertices[0][1] === vertices[vertices.length - 1][1]
    )
      vertices.pop();
    if (vertices.length < 3) {
      droppedRows += 1;
      continue;
    }
    const { percent, level } = gpsjamLevel(total, bad);
    cells.push({
      hex,
      lat: round6(lat),
      lon: round6(lon),
      boundary: vertices,
      good,
      bad,
      total,
      percent,
      level,
    });
  }
  cells.sort((a, b) => a.hex.localeCompare(b.hex));
  return { worldRows, droppedRows, cells };
}

export function gpsjamDailyProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
} = {}) {
  const TTL_MS = GPSJAM_PROXY_TTL_MS;
  const CACHE_DIR = cacheDir;
  const CACHE_PATH = path.join(CACHE_DIR, 'gpsjam.json');

  /** @type {?{at: number, date: string, source: string|null, suspect: boolean|null, worldRows: number, cells: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (
        Number.isFinite(parsed?.at) &&
        typeof parsed?.date === 'string' &&
        Array.isArray(parsed?.cells)
      ) {
        mem = {
          at: parsed.at,
          date: parsed.date,
          source: parsed.source ?? null,
          suspect: parsed.suspect ?? null,
          worldRows: Number.isFinite(parsed.worldRows) ? parsed.worldRows : 0,
          cells: parsed.cells,
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
      warn('[gpsjam-proxy] cache write failed:', err?.message || err);
    }
  }

  /** Fetch one upstream text file. Returns null on HTTP 404, throws otherwise. */
  async function fetchText(url) {
    const signal = AbortSignal.timeout(GPSJAM_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(url, {
      signal,
      headers: {
        Accept: 'text/csv',
        'User-Agent': GPSJAM_PROXY_USER_AGENT,
      },
    });
    if (res.status === 404) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let text;
    try {
      text = await readResponseTextCapped(
        res,
        GPSJAM_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    return text;
  }

  /**
   * Refresh from upstream: manifest first (non-fatal — a manifest
   * failure still leaves the CSV usable, just without its suspect flag
   * and source label), then the newest publishable daily CSV.
   * Throws when no candidate day yields a usable file.
   */
  async function refreshUpstream() {
    const started = now();
    let manifest = new Map();
    try {
      const manifestText = await fetchText(`${GPSJAM_BASE_URL}/manifest.csv`);
      if (manifestText != null) manifest = parseGpsjamManifest(manifestText);
    } catch (err) {
      warn(
        '[gpsjam-proxy] manifest fetch failed, continuing without it:',
        err?.message || err,
      );
    }
    for (const date of gpsjamCandidateDates(started)) {
      let csvText;
      try {
        csvText = await fetchText(`${GPSJAM_BASE_URL}/${date}-h3_4.csv`);
      } catch (err) {
        warn(`[gpsjam-proxy] ${date} fetch failed:`, err?.message || err);
        throw err;
      }
      if (csvText == null) continue; // 404 — day not published yet
      if (!csvText.startsWith('hex,'))
        throw new Error('non-CSV upstream response');
      const { worldRows, droppedRows, cells } = parseGpsjamCsv(csvText);
      if (droppedRows > 0)
        warn(
          `[gpsjam-proxy] ${date}: dropped ${droppedRows} malformed CSV rows`,
        );
      if (worldRows === 0) throw new Error('empty upstream CSV');
      const meta = manifest.get(date) ?? { suspect: null, source: null };
      return {
        at: started,
        date,
        source: meta.source,
        suspect: meta.suspect,
        worldRows,
        cells,
      };
    }
    throw new Error('no published GPSJam day available');
  }

  function buildPayload(entry, stale) {
    return {
      date: entry.date,
      source: entry.source,
      suspect: entry.suspect,
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      worldRows: entry.worldRows,
      count: entry.cells.length,
      cells: entry.cells,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/gpsjam', async (req, res) => {
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
            date: mem ? mem.date : null,
            count: mem ? mem.cells.length : null,
            stale: mem ? now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
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
                `[gpsjam-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: 'gpsjam fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[gpsjam-proxy] error:', err?.message || err);
        sendJson(500, { error: 'gpsjam proxy error' });
      }
    });
  };
  return {
    name: 'gpsjam-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
