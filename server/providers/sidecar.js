// Cape Dispatch news sidecar proxy:
// /api/news/*, /api/alerts/*, /api/credibility/*, /news, /news/feed.xml,
// /news/<slug>, /blog
//   -> ${SIDECAR_URL}/<same path>
// The sidecar is the Python news/alert service (sidecar/, loopback 8120):
// news ingest + auto-catch alerts, ADS-B/ACARS/IPAWS/lightning watchers,
// and the Gemini blog writer. GET/HEAD only; small in-memory cache +
// inflight coalescing, same shape as the cape proxy (server/providers/cape.js).
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 30_000;
const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8120';

/** Sidecar base URL from env; anything unparseable falls back to loopback. */
export function resolveSidecarUrl(env = process.env) {
  const raw = String(env.SIDECAR_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!raw) return DEFAULT_SIDECAR_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      return DEFAULT_SIDECAR_URL;
  } catch {
    return DEFAULT_SIDECAR_URL;
  }
  return raw;
}

/**
 * Mount-relative path allowlist. The middleware is mounted once per prefix
 * (/api/news, /api/alerts, /news, /blog), so req.url arrives stripped of
 * that prefix: '/' is the collection itself, '/latest' a sub-path, and
 * '/<slug>' an article. '..' never passes, and nothing outside the
 * news/alert surface is proxied (no admin, no review writes, no DB).
 */
export function sidecarAllowed(path) {
  if (!path || path.includes('..')) return false;
  const p = path.replace(/^\/+/, '');
  if (p === '') return true;
  const first = p.split('/')[0];
  // Article slugs, feed.xml, and API sub-paths are single-segment after the
  // mount prefix; deeper paths are not sidecar routes.
  if (p.split('/').length > 1) return false;
  return /^[a-z0-9][a-z0-9._-]*$/i.test(first);
}

function isPageRequest(req, prefix) {
  // /news and /blog serve HTML pages from the sidecar; /api/* serves JSON.
  return prefix === '/news' || prefix === '/blog';
}

export function createSidecarMiddleware({
  baseUrl,
  prefix = '/api/news',
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const base = resolveSidecarUrl(
    baseUrl == null ? process.env : { SIDECAR_URL: baseUrl },
  );
  const cache = new Map();
  const inflight = new Map();

  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://local');
    const path = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!sidecarAllowed(path)) {
      // Not a sidecar path after all — let Vite (SPA fallback) handle it.
      return next();
    }
    const key = `${prefix}${path}${url.search}`;
    const now = Date.now();
    let hit = cache.get(key);
    if (!hit || hit.exp < now) {
      let job = inflight.get(key);
      if (!job) {
        job = (async () => {
          const ctl = AbortSignal.timeout(TIMEOUT_MS);
          // The collection itself is the bare prefix ('/news', not '/news/'):
          // FastAPI redirects a trailing slash, so don't send one.
          const upstreamPath = path === '/' ? prefix : `${prefix}${path}`;
          const r = await fetchImpl(`${base}${upstreamPath}${url.search}`, {
            signal: ctl,
            headers: {
              Accept: '*/*',
              'User-Agent': 'gods-eye-view-sidecar-proxy',
            },
          });
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > MAX_BYTES)
            throw new Error('sidecar response too large');
          const entry = {
            status: r.status,
            type: r.headers.get('content-type') || 'application/octet-stream',
            body: buf,
            exp: Date.now() + (r.ok ? CACHE_TTL_MS : 5000),
            at: Date.now(),
          };
          cache.set(key, entry);
          if (cache.size > 500) cache.delete(cache.keys().next().value);
          return entry;
        })().finally(() => inflight.delete(key));
        inflight.set(key, job);
      }
      try {
        hit = await job;
      } catch (e) {
        if (hit) {
          res.setHeader('X-Sidecar-Stale', '1');
        } else {
          res.statusCode = 502;
          if (
            isPageRequest(req, prefix) &&
            String(req.headers?.accept || '').includes('text/html')
          ) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(
              '<!doctype html><title>News unavailable</title>' +
                '<h1>Cape Dispatch news is unavailable</h1>' +
                '<p>The news sidecar is not running. Try again shortly.</p>',
            );
          }
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({
              error: 'sidecar_unavailable',
              detail: String(e?.message || e),
            }),
          );
        }
      }
    }
    res.statusCode = hit.status;
    res.setHeader('Content-Type', hit.type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Sidecar', '1');
    res.setHeader('X-Sidecar-Age-Ms', String(Date.now() - hit.at));
    res.end(req.method === 'HEAD' ? undefined : hit.body);
  };
}

const SIDECAR_MOUNTS = [
  '/api/news',
  '/api/alerts',
  '/api/credibility',
  '/news',
  '/blog',
];

export function sidecarProxy({ baseUrl } = {}) {
  // One middleware (one cache) per mount — created at install, not per request.
  const middlewares = new Map();
  const install = (server) => {
    for (const prefix of SIDECAR_MOUNTS) {
      const mw =
        middlewares.get(prefix) || createSidecarMiddleware({ baseUrl, prefix });
      middlewares.set(prefix, mw);
      server.middlewares.use(prefix, (req, res, next) => mw(req, res, next));
    }
  };
  return {
    name: 'cape-news-sidecar-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
