/**
 * Read-only proxy for the previous Cape Dispatch app.
 *
 * That app listens on CAPE_DISPATCH_URL (default http://127.0.0.1:8100).
 * There is no /api/cape prefix on it. This route adds one so God's Eye View
 * can sit on capemaydispatch.com without calling itself:
 *
 *   GET /api/cape/api/cad/incidents  →  {CAPE_DISPATCH_URL}/api/cad/incidents
 *   GET /api/cape/fw-audio/<file>    →  {CAPE_DISPATCH_URL}/fw-audio/<file>
 *
 * Only the old app's public read paths are forwarded. POST /api/ingest/file
 * and every other write stay on Fire Wire and are not reachable here.
 */
import { makeRateLimiter } from '../../../src/sources/rateLimit.js';
import { clientKey } from '../common/rate-limit.js';
import {
  capeDispatchOrigin,
  capeQueryAllowed,
  capeUpstreamPath,
} from '../../../src/publicExposure.mjs';

const MAX_JSON = 4 * 1024 * 1024;
const MAX_MEDIA = 20 * 1024 * 1024;
const CACHE_LIMIT = 64;

function contentKind(header) {
  const type = String(header || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type === 'text/plain') return { type, media: false };
  if (type.startsWith('audio/') || type.startsWith('image/')) return { type, media: true };
  return null;
}

export function capeProxy({ fetchImpl = fetch, now = Date.now, env = process.env } = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 120, globalMax: 800 });
  const cache = new Map();

  function remember(key, entry) {
    cache.set(key, entry);
    if (cache.size <= CACHE_LIMIT) return;
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }

  async function handle(req, res) {
    const json = (status, body, extra = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extra,
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return json(405, { error: 'GET only' }, { Allow: 'GET' });
    if (!allow(clientKey(req)))
      return json(429, { error: 'Too many Cape Dispatch requests' }, { 'Retry-After': '60' });

    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return json(400, { error: 'Bad request' });
    }
    const upstreamPath = capeUpstreamPath('GET', url.pathname);
    if (!upstreamPath || !capeQueryAllowed(url.search))
      return json(404, { error: 'Not found' });
    const upstream = capeDispatchOrigin(env);
    if (!upstream.ok) return json(503, { error: 'Cape Dispatch upstream is not configured on a local origin' });

    const cacheKey = `${upstreamPath}${url.search}`;
    const hit = cache.get(cacheKey);
    const ttl = upstreamPath.startsWith('/fw-audio/') ? 60_000 : 15_000;
    if (hit && now() - hit.at < ttl) {
      res.writeHead(hit.status, {
        'Content-Type': hit.type,
        'Cache-Control': hit.media ? 'public, max-age=60' : 'public, max-age=15',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(hit.body);
    }

    let response;
    try {
      response = await fetchImpl(`${upstream.origin}${cacheKey}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json, audio/*, image/*' },
      });
    } catch {
      return json(502, { error: 'Cape Dispatch is not reachable' });
    }
    const kind = contentKind(response.headers.get('content-type'));
    if (!response.ok || !kind) return json(502, { error: 'Cape Dispatch returned an unexpected response' });
    const cap = kind.media ? MAX_MEDIA : MAX_JSON;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap)
      return json(502, { error: 'Cape Dispatch response is too large' });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > cap) return json(502, { error: 'Cape Dispatch response is too large' });
    remember(cacheKey, { at: now(), status: response.status, type: kind.type, body, media: kind.media });
    res.writeHead(response.status, {
      'Content-Type': kind.type,
      'Cache-Control': kind.media ? 'public, max-age=60' : 'public, max-age=15',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  function install(server) {
    server.middlewares.use('/api/cape', (req, res) => {
      return handle(req, res).catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Cape Dispatch proxy failed' }));
        }
      });
    });
  }

  return { name: 'cape-dispatch-proxy', configureServer: install, configurePreviewServer: install };
}
