import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readResponseJsonCapped } from './common/http.js';
import {
  selectVdl2Rows,
  VDL2_API_BASE,
  VDL2_API_LIMIT,
  VDL2_KEYWORDS,
  VDL2_STATION_ID,
} from '../../src/layers/vdl2/records.js';

/**
 * VDL2 datalink-messages proxy.
 *
 * Upstream: the public airframes.io REST API (free, anonymous on
 * public endpoints — verified live 2026-11-16). No key, shared
 * anonymous budget 60 req/min. One refresh is 12 requests: a baseline
 * station query plus one query per incident keyword, sequential (the
 * watcher polls the same way, one query per keyword per 5-minute
 * cycle, never retrying in a burst).
 *
 *   GET /v1/messages?station_ids=237335008&timeframe=last-hour&limit=100
 *   GET /v1/messages?text=<keyword>&timeframe=last-hour&limit=100   (×11)
 *
 * The baseline is the PhillyRox-VDLM feeder at Philadelphia (KPHL),
 * station id 237335008, ≥100 messages/hour (verified live — the
 * last-hour station query hit the 100-row API limit, so `heardLocal`
 * is a lower bound and `heardTruncated` is set). The keyword fan-out
 * is what catches nationwide emergencies: an unfiltered last-hour
 * fetch returns only the newest 100 messages *globally* (~2M/day),
 * so the fan-out is the only way a client sees a mayday anywhere.
 * A direct browser fetch does work (CORS reflects any Origin,
 * verified 2026-11-16) — the proxy exists so the fan-out happens
 * once, server-side, against the shared 60 req/min budget, following
 * the FIRMS `/api/firms` pattern.
 *
 * Filtering is server-side, in the shared pure module
 * (src/layers/vdl2/records.js — the same code the client validates
 * against): VDL2 only (`sourceType === 'vdl'` — the `sourceType=vdl`
 * query param is ignored by the API, verified live: a filtered
 * request returned 87 vdl / 8 acars / 5 aero-acars in 100 rows),
 * categorized messages that are nationwide emergencies or local, plus
 * local undecoded frames. The raw message `text` never leaves this
 * proxy — rows carry the category, never the text.
 *
 * Station health: PhillyRox-VDLM is flagged by airframes.io for a
 * rate anomaly (verified live 2026-11-16), so coverage may be
 * interrupted; the flag is reported as `stationFlagged` /
 * `stationFlagReason` and surfaced in the panel.
 *
 * CORRECTION: the Python ACARS watcher's docstring names a "Trenton"
 * VDL2 station `RK-KBOS_TRENTON-VDL2`; that station is actually in
 * New Hampshire (43.12, −71.77), NOT Trenton — it is not queried here.
 *
 * Cache: 5-minute TTL (the layer polls every 5 minutes), single-flight
 * refresh, serve-stale-on-failure, and a disk cache
 * (.gev-cache/vdl2.json) so a restart does not re-hit the upstream.
 *
 * Routes:
 *   GET /api/vdl2        → {fetchedAt, stale, ttlMs, heardLocal, heardTruncated, stationFlagged, stationFlagReason, count, rows}
 *   GET /api/vdl2/status → {lastFetch, heardLocal, count, stale, ttlMs}
 *
 * @returns {import('vite').Plugin}
 */

export const VDL2_PROXY_TTL_MS = 5 * 60_000;
export const VDL2_PROXY_TIMEOUT_MS = 30_000;
export const VDL2_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const VDL2_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The upstream query URLs for one refresh, in call order. */
export function vdl2UpstreamUrls() {
  const base = `${VDL2_API_BASE}?timeframe=last-hour&limit=${VDL2_API_LIMIT}`;
  const urls = [`${base}&station_ids=${VDL2_STATION_ID}`];
  for (const keyword of VDL2_KEYWORDS)
    urls.push(`${base}&text=${encodeURIComponent(keyword)}`);
  return urls;
}

export function vdl2DailyProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
} = {}) {
  const TTL_MS = VDL2_PROXY_TTL_MS;
  const CACHE_DIR = cacheDir;
  const CACHE_PATH = path.join(CACHE_DIR, 'vdl2.json');

  /** @type {?{at: number, heardLocal: number|null, heardTruncated: boolean, stationFlagged: boolean, stationFlagReason: string|null, rows: Array<object>}} */
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
        Array.isArray(parsed?.rows)
      ) {
        mem = {
          at: parsed.at,
          heardLocal: Number.isFinite(parsed.heardLocal)
            ? parsed.heardLocal
            : null,
          heardTruncated: parsed.heardTruncated === true,
          stationFlagged: parsed.stationFlagged === true,
          stationFlagReason:
            typeof parsed.stationFlagReason === 'string'
              ? parsed.stationFlagReason
              : null,
          rows: parsed.rows,
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
      warn('[vdl2-proxy] cache write failed:', err?.message || err);
    }
  }

  /** Fetch one upstream JSON list. Returns [] on any failure (never throws). */
  async function fetchList(url) {
    const signal = AbortSignal.timeout(VDL2_PROXY_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': VDL2_PROXY_USER_AGENT,
        },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        warn(`[vdl2-proxy] ${url} → HTTP ${res.status}`);
        return [];
      }
      let data;
      try {
        data = await readResponseJsonCapped(
          res,
          VDL2_MAX_RESPONSE_BYTES,
          signal,
        );
      } catch (err) {
        if (err?.code === 'RESPONSE_TOO_LARGE') {
          warn('[vdl2-proxy] upstream response exceeded size cap');
          return [];
        }
        throw err;
      }
      return Array.isArray(data) ? data : [];
    } catch (err) {
      warn(`[vdl2-proxy] fetch failed (${err?.message || err})`);
      return [];
    }
  }

  /**
   * Refresh from upstream: the baseline station query first (it also
   * reports how much local traffic was heard and whether the feeder is
   * flagged), then the 11 keyword queries, sequential. Selection and
   * categorization live in the shared records module; the raw text
   * never leaves this proxy. Throws only when nothing usable came back
   * at all (no baseline and no keyword rows).
   */
  async function refreshUpstream() {
    const started = now();
    const urls = vdl2UpstreamUrls();
    const baseline = await fetchList(urls[0]);
    const heardLocal = baseline.filter(
      (msg) => msg && typeof msg === 'object' && msg.sourceType === 'vdl',
    ).length;
    const heardTruncated = baseline.length >= VDL2_API_LIMIT;
    let stationFlagged = false;
    let stationFlagReason = null;
    for (const msg of baseline) {
      const station = msg?.station;
      if (station && typeof station === 'object' && station.flagged === true) {
        stationFlagged = true;
        if (typeof station.flaggedReason === 'string')
          stationFlagReason = station.flaggedReason;
        break;
      }
    }
    const all = [...baseline];
    for (const url of urls.slice(1)) {
      for (const msg of await fetchList(url)) all.push(msg);
    }
    if (baseline.length === 0 && all.length === 0)
      throw new Error('no VDL2 messages from upstream');
    return {
      at: started,
      heardLocal,
      heardTruncated,
      stationFlagged,
      stationFlagReason,
      rows: selectVdl2Rows(all),
    };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      heardLocal: entry.heardLocal,
      heardTruncated: entry.heardTruncated,
      stationFlagged: entry.stationFlagged,
      stationFlagReason: entry.stationFlagReason,
      count: entry.rows.length,
      rows: entry.rows,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/vdl2', async (req, res) => {
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
            heardLocal: mem ? mem.heardLocal : null,
            count: mem ? mem.rows.length : null,
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
                `[vdl2-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: 'vdl2 fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[vdl2-proxy] error:', err?.message || err);
        sendJson(500, { error: 'vdl2 proxy error' });
      }
    });
  };
  return {
    name: 'vdl2-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
