import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readResponseTextCapped } from './common/http.js';

/**
 * USCG Broadcast Notices to Mariners proxy.
 *
 * Upstream: the Coast Guard's own GovDelivery RSS feeds — Sector Delaware
 * Bay (primary, locally scoped) and District 5 (East, filtered client-side
 * by the layer):
 *   https://public.govdelivery.com/topics/USDHSCG_248/feed.rss
 *   https://public.govdelivery.com/topics/USDHSCG_250/feed.rss
 * Free, keyless, U.S. public domain. GovDelivery is the Coast Guard's own
 * subscription service and its public RSS is its intended machine-readable
 * channel — poll every 15 min, no harder.
 *
 * GovDelivery sends NO CORS headers (verified 2026-11-16), so the browser
 * can never fetch these feeds directly — hence this same-origin proxy.
 * The proxy only extracts the raw RSS items; parsing, filtering,
 * tombstones and expiry live in src/layers/marineWarnings/records.js.
 *
 * Cache: 15-min TTL, single-flight refresh, serve-stale-on-failure, and a
 * disk cache (.gev-cache/marine-warnings.json) so a restart does not
 * re-hit the upstream. Pattern mirrors firmsProxy. One feed down does not
 * sink the other: a partial refresh still produces a cacheable entry with
 * the failed feed marked ok:false.
 *
 * Routes:
 *   GET /api/marine-warnings        → {fetchedAt, stale, ttlMs, sources, count, items}
 *   GET /api/marine-warnings/status → {lastFetch, count, stale, ttlMs, sources}
 *
 * @returns {import('vite').Plugin}
 */

export const MARINE_WARNINGS_PROXY_TTL_MS = 15 * 60_000;
export const MARINE_WARNINGS_PROXY_TIMEOUT_MS = 10_000;
export const MARINE_WARNINGS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const MARINE_WARNINGS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export const MARINE_WARNINGS_FEEDS = Object.freeze([
  Object.freeze({
    id: 'sector-delaware-bay',
    label: 'Sector Delaware Bay',
    url: 'https://public.govdelivery.com/topics/USDHSCG_248/feed.rss',
  }),
  Object.freeze({
    id: 'district-5',
    label: 'District 5',
    url: 'https://public.govdelivery.com/topics/USDHSCG_250/feed.rss',
  }),
]);

/** One RSS field: `<tag>…</tag>` or `<tag attr="…">…</tag>`, CDATA or plain. */
function extractRssField(block, tag) {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
  );
  const match = pattern.exec(block);
  if (!match) return '';
  return (match[1] ?? match[2] ?? '').trim();
}

/**
 * Extract the raw items of one GovDelivery RSS document. Field values are
 * verbatim (description keeps its HTML — records.js strips it). Items
 * without a title are skipped; a document with no `<item>` at all yields
 * [] (never null — an empty feed is a valid, if suspicious, response).
 * Never throws on malformed input.
 */
export function extractRssItems(xmlText) {
  if (typeof xmlText !== 'string' || xmlText === '') return [];
  const items = [];
  for (const match of xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = extractRssField(block, 'title');
    if (!title) continue;
    items.push({
      title,
      link: extractRssField(block, 'link') || null,
      guid: extractRssField(block, 'guid') || null,
      pubDate: extractRssField(block, 'pubDate') || null,
      description: extractRssField(block, 'description'),
    });
  }
  return items;
}

export function marineWarningsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
  cacheDir = path.join(process.cwd(), '.gev-cache'),
} = {}) {
  const TTL_MS = MARINE_WARNINGS_PROXY_TTL_MS;
  const CACHE_DIR = cacheDir;
  const CACHE_PATH = path.join(CACHE_DIR, 'marine-warnings.json');

  /** @type {?{at: number, sources: Array<object>, items: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at: number, sources: Array<object>, items: Array<object>}>} single-flight refresh */
  let inflight = null;

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (
        Number.isFinite(parsed?.at) &&
        Array.isArray(parsed?.sources) &&
        Array.isArray(parsed?.items)
      ) {
        mem = { at: parsed.at, sources: parsed.sources, items: parsed.items };
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
      warn('[marine-warnings-proxy] cache write failed:', err?.message || err);
    }
  }

  /** Fetch + extract one feed. Throws on HTTP error, oversize, or non-RSS. */
  async function fetchFeed(feed) {
    const signal = AbortSignal.timeout(MARINE_WARNINGS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(feed.url, {
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': MARINE_WARNINGS_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let text;
    try {
      text = await readResponseTextCapped(
        res,
        MARINE_WARNINGS_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    if (!/<rss[\s>]|<feed[\s>]/.test(text))
      throw new Error('non-RSS upstream response');
    return extractRssItems(text);
  }

  /**
   * Refresh both feeds. Partial success (≥1 feed ok) still produces a
   * cacheable entry with the failed feed marked ok:false; total failure
   * throws so the caller can serve stale.
   */
  async function refreshUpstream() {
    const started = now();
    const settled = await Promise.allSettled(
      MARINE_WARNINGS_FEEDS.map(async (feed) => {
        const items = await fetchFeed(feed);
        return { feed, items };
      }),
    );
    const sources = [];
    const items = [];
    for (const [index, result] of settled.entries()) {
      const feed = MARINE_WARNINGS_FEEDS[index];
      if (result.status === 'fulfilled') {
        for (const item of result.value.items)
          items.push({ ...item, feed: feed.id });
        sources.push({
          feed: feed.id,
          count: result.value.items.length,
          ok: true,
        });
      } else {
        warn(
          `[marine-warnings-proxy] ${feed.id} fetch failed:`,
          result.reason?.message || result.reason,
        );
        sources.push({ feed: feed.id, count: 0, ok: false });
      }
    }
    if (!sources.some((s) => s.ok))
      throw new Error('all marine warning feeds failed');
    return { at: started, sources, items };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      sources: entry.sources,
      count: entry.items.length,
      items: entry.items,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/marine-warnings', async (req, res) => {
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
            count: mem ? mem.items.length : null,
            stale: mem ? now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            sources: mem ? mem.sources : null,
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
                `[marine-warnings-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: 'marine warnings fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[marine-warnings-proxy] error:', err?.message || err);
        sendJson(500, { error: 'marine warnings proxy error' });
      }
    });
  };
  return {
    name: 'marine-warnings-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
