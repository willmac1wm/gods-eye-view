// server/providers/gdacs.js
// GDACS multi-hazard RSS proxy. GDACS is the Joint Research Centre / UN
// OCHA disaster alert system; the feed is public domain (per-event
// resources EU CC BY 4.0). GDACS sends no CORS headers for the RSS feed,
// so the browser never fetches it directly — hence this same-origin proxy.
// The proxy only extracts the raw RSS items; normalization, sorting and
// filtering live in src/layers/gdacs/records.js. Pattern mirrors
// marineWarningsProxy (RSS) with the gauges proxy's 429 backoff.
//
// Routes:
//   GET /api/gdacs        → {fetchedAt, stale, ttlMs, count, events}
//   GET /api/gdacs/status → {lastFetch, count, stale, ttlMs}
//
// @returns {import('vite').Plugin}
import { readResponseTextCapped } from './common/http.js';

export const GDACS_FEED_URL = 'https://www.gdacs.org/xml/rss.xml';
export const GDACS_PROXY_TTL_MS = 15 * 60_000;
export const GDACS_PROXY_TIMEOUT_MS = 10_000;
export const GDACS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const GDACS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const GDACS_BACKOFF_MS = 60_000;

/** The upstream feed URL (exposed for tests). */
export function gdacsUpstreamUrl() {
  return GDACS_FEED_URL;
}

/** One RSS field: `<tag>…</tag>` or `<tag attr="…">…</tag>`, CDATA or plain. */
function extractRssField(block, tag) {
  const pattern = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`,
  );
  const match = pattern.exec(block);
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? '').trim();
  return value || null;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** The `<tag unit=".." value="..">inner text</tag>` shape (severity, population). */
function attributedTag(block, tag) {
  const match = block.match(
    new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`),
  );
  if (!match) return null;
  const attrs = match[1] ?? '';
  const unit = attrs.match(/unit="([^"]*)"/)?.[1] ?? null;
  const value = attrs.match(/value="([^"]*)"/)?.[1] ?? null;
  const text = (match[2] ?? '').trim() || null;
  return { text, unit, value };
}

/** The geo:Point lat/long, with the georss:point fallback. */
function geoPoint(block) {
  const lat = extractRssField(block, 'geo:lat');
  const lon = extractRssField(block, 'geo:long');
  if (lat !== null && lon !== null) return { lat, lon };
  const point = extractRssField(block, 'georss:point');
  if (point) {
    const parts = point.trim().split(/\s+/);
    if (parts.length >= 2) return { lat: parts[0], lon: parts[1] };
  }
  return { lat: null, lon: null };
}

/**
 * Extract the raw items of one GDACS RSS document. Field values are
 * verbatim; normalization lives in src/layers/gdacs/records.js. Items
 * without a title are skipped; a document with no `<item>` at all yields
 * [] (never null — an empty feed is a valid, if suspicious, response).
 * Never throws on malformed input.
 */
export function extractGdacsRssItems(xmlText) {
  if (typeof xmlText !== 'string' || xmlText === '') return [];
  const items = [];
  for (const match of xmlText.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const title = extractRssField(block, 'title');
    if (!title) continue;
    const { lat, lon } = geoPoint(block);
    const link = extractRssField(block, 'link');
    items.push({
      title,
      description: extractRssField(block, 'description'),
      link: link ? decodeEntities(link) : null,
      pubDate: extractRssField(block, 'pubDate'),
      fromDate: extractRssField(block, 'gdacs:fromdate'),
      toDate: extractRssField(block, 'gdacs:todate'),
      eventType: extractRssField(block, 'gdacs:eventtype'),
      alertLevel: extractRssField(block, 'gdacs:alertlevel'),
      alertScore: extractRssField(block, 'gdacs:alertscore'),
      eventId: extractRssField(block, 'gdacs:eventid'),
      episodeId: extractRssField(block, 'gdacs:episodeid'),
      isCurrent: extractRssField(block, 'gdacs:iscurrent'),
      country: extractRssField(block, 'gdacs:country'),
      iso3: extractRssField(block, 'gdacs:iso3'),
      glide: extractRssField(block, 'gdacs:glide'),
      lat,
      lon,
      georssPoint: extractRssField(block, 'georss:point'),
      severity: attributedTag(block, 'gdacs:severity'),
      population: attributedTag(block, 'gdacs:population'),
    });
  }
  return items;
}

function parseRetryAfterMs(response, now) {
  const raw = response?.headers?.get?.('Retry-After');
  if (raw == null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 60 * 60_000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now());
  return null;
}

export function gdacsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  const TTL_MS = GDACS_PROXY_TTL_MS;
  /** @type {?{at: number, events: Array<object>}} */
  let mem = null;
  /** @type {?Promise<?{at: number, events: Array<object>}>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  /** Fetch + extract the feed. Throws on HTTP error, oversize, or non-RSS. */
  async function refreshUpstream() {
    const signal = AbortSignal.timeout(GDACS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(GDACS_FEED_URL, {
      signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': GDACS_PROXY_USER_AGENT,
      },
    });
    if (res.status === 429) {
      const error = new Error('GDACS rate limited (HTTP 429)');
      error.rateLimited = true;
      error.retryAfterMs = parseRetryAfterMs(res, now);
      await res.body?.cancel().catch(() => {});
      throw error;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    let text;
    try {
      text = await readResponseTextCapped(
        res,
        GDACS_MAX_RESPONSE_BYTES,
        signal,
      );
    } catch (err) {
      if (err?.code === 'RESPONSE_TOO_LARGE')
        throw new Error('upstream response exceeded size cap');
      throw err;
    }
    if (!/<rss[\s>]|<feed[\s>]/.test(text))
      throw new Error('non-RSS upstream response');
    return { at: now(), events: extractGdacsRssItems(text) };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      count: entry.events.length,
      events: entry.events,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/gdacs', async (req, res) => {
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
            count: mem ? mem.events.length : null,
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
        // In backoff after repeated failures: serve stale, do not hammer
        // the upstream. A cold cache in backoff still answers 502.
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error: lastFailure ?? 'GDACS fetch failed and no cache available',
          });
          return;
        }
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              const retryAfterMs =
                err?.rateLimited === true ? err.retryAfterMs : null;
              backoffUntil = now() + (retryAfterMs ?? GDACS_BACKOFF_MS);
              // A bare HTTP status adds nothing to a cold-cache 502, so
              // only a rate limit gets a specific message.
              lastFailure =
                err?.rateLimited === true
                  ? 'GDACS rate limited (HTTP 429)'
                  : null;
              warn(
                `[gdacs-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
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
            error: lastFailure ?? 'GDACS fetch failed and no cache available',
          });
        }
      } catch (err) {
        warn('[gdacs-proxy] error:', err?.message || err);
        sendJson(500, { error: 'gdacs proxy error' });
      }
    });
  };
  return {
    name: 'gdacs-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
