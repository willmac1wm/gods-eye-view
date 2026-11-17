// server/providers/navarea.js
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  NAVAREA_DOWNLOAD_KEY,
  NAVAREA_PROXY_TIMEOUT_MS,
  NAVAREA_PROXY_TTL_MS,
  NAVAREA_PROXY_USER_AGENT,
  navareaDownloadUrl,
} from '../../src/layers/navarea/policy.js';
import { parseNavareaBulletin } from '../../src/layers/navarea/records.js';
import { readResponseTextCapped } from './common/http.js';

/**
 * NGA NAVAREA IV warnings proxy.
 *
 * Upstream (public domain, no key, no registration):
 *   GET https://msi.nga.mil/api/publications/download?key=16694640/SFH00000/DailyMemIV.txt&type=view
 *   → daily plain-text bulletin of warnings in force (NAVAREA IV
 *   1098/26 etc.). The key was verified from NGA's own indexed
 *   publication record (2026-11-17); it may rotate when NGA
 *   republishes — override with NGA_NAVAREA_KEY (same key= value
 *   form) or re-verify it from the live portal. HYDROLANT is not
 *   fetched in v1: its download key/filename is unverified.
 *
 * BUILD BLOCKER (verified 2026-11-17): msi.nga.mil returns HTTP 503
 * (Akamai apology page) for the portal, the home page, and this
 * download URL, from BOTH this VM and Legion — the provider cannot
 * fetch live bulletins today. It degrades to the last cached bulletin
 * (disk cache survives restarts) labeled stale, or 502 with no cache.
 * Do not work around it (no mirrors, no header tricks). The layer is
 * complete and lights up when NGA serves again.
 *
 * Routes:
 *   GET /api/navarea → {fetchedAt, stale, bulletinDate, inForceCount, warnings}
 *
 * @returns {import('vite').Plugin}
 */
const NAVAREA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const NAVAREA_BACKOFF_MS = 60_000;

export function navareaProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
  downloadKey = process.env?.NGA_NAVAREA_KEY || NAVAREA_DOWNLOAD_KEY,
} = {}) {
  const CACHE_PATH = path.join(cacheDir, 'navarea.json');
  /** @type {?{at: number, bulletinDate: ?string, inForceCount: number, warnings: Array}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
      if (Number.isFinite(parsed?.at) && Array.isArray(parsed?.warnings)) {
        mem = {
          at: parsed.at,
          bulletinDate: parsed.bulletinDate ?? null,
          inForceCount: parsed.inForceCount ?? parsed.warnings.length,
          warnings: parsed.warnings,
        };
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      warn('[navarea-proxy] cache write failed:', err?.message || err);
    }
  }

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(NAVAREA_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(navareaDownloadUrl(downloadKey), {
      signal,
      headers: {
        Accept: 'text/plain',
        'User-Agent': NAVAREA_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`NGA HTTP ${res.status}`);
    }
    const text = await readResponseTextCapped(
      res,
      NAVAREA_MAX_RESPONSE_BYTES,
      signal,
    );
    const parsed = parseNavareaBulletin(text);
    if (parsed.warnings.length === 0 && parsed.inForceCount === 0) {
      throw new Error('NGA bulletin parsed to zero warnings');
    }
    return { at: now(), ...parsed };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      bulletinDate: entry.bulletinDate,
      inForceCount: entry.inForceCount,
      warnings: entry.warnings,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/navarea', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        await readDiskOnce();
        const entry = mem;
        if (entry && now() - entry.at < NAVAREA_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'NGA bulletin unavailable',
          });
          return;
        }
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              writeDisk(fresh);
              return mem;
            })
            .catch((err) => {
              backoffUntil = now() + NAVAREA_BACKOFF_MS;
              lastFailure = err?.message || String(err);
              warn(
                `[navarea-proxy] refresh failed (${lastFailure}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const fresh = await inflight;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error: lastFailure ?? 'NGA bulletin unavailable',
          });
        }
      } catch (err) {
        warn('[navarea-proxy] error:', err?.message || err);
        sendJson(500, { error: 'navarea proxy error' });
      }
    });
  };
  return {
    name: 'navarea-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
