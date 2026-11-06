import { isRetiredCapeWebsite, resolveCapeUpstream } from '../capeUpstream.js';
import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

const MIB = 1024 * 1024;
const CACHE_TTL_MS = 45_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function platformFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (
      host === 'x.com' ||
      host === 'twitter.com' ||
      host.endsWith('.twitter.com')
    )
      return 'x';
    if (host === 'facebook.com' || host.endsWith('.facebook.com'))
      return 'facebook';
    if (host === 'instagram.com' || host.endsWith('.instagram.com'))
      return 'instagram';
    if (
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host.endsWith('.youtube.com')
    )
      return 'youtube';
    if (host === 'reddit.com' || host.endsWith('.reddit.com')) return 'reddit';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
    if (host === 'threads.net') return 'threads';
    if (host === 'bsky.app' || host.endsWith('.bsky.social')) return 'bluesky';
    return 'web';
  } catch {
    return null;
  }
}

export function normalizeSocialItem(raw, fallbackSource = 'wire') {
  if (!raw || typeof raw !== 'object') return null;
  const url = raw.url || raw.link || raw.permalink || null;
  const title =
    raw.title || raw.keyword || raw.text || raw.body || raw.headline || null;
  if (!title && !url) return null;
  const at =
    raw.at ||
    raw.time ||
    raw.created_at ||
    raw.published_at ||
    raw.timestamp ||
    null;
  return {
    id: String(raw.id || raw.guid || `${fallbackSource}:${title}:${url || ''}`),
    title: title || url,
    body: raw.body || raw.summary || raw.description || null,
    source: raw.source || fallbackSource,
    platform: raw.platform || (url ? platformFromUrl(url) : null),
    url: url && /^https?:\/\//i.test(url) ? url : null,
    town: raw.town || raw.place || raw.municipality || null,
    at,
  };
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.posts)) return payload.posts;
  if (Array.isArray(payload?.feed)) return payload.feed;
  if (Array.isArray(payload?.flash_rumors)) return payload.flash_rumors;
  if (Array.isArray(payload?.rumors)) return payload.rumors;
  return [];
}

export function createSocialHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  resolveUpstream = resolveCapeUpstream,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function fetchCape(path) {
    const base = resolveUpstream();
    if (!base || isRetiredCapeWebsite(base)) return null;
    const url = new URL(`/api/${path}`, `${base}/`);
    const signal = AbortSignal.timeout(15_000);
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      return null;
    }
    return readResponseJsonCapped(response, 2 * MIB, signal);
  }

  async function upstream() {
    const [board, social, news, wire] = await Promise.all([
      fetchCape('board').catch(() => null),
      fetchCape('social').catch(() => null),
      fetchCape('news').catch(() => null),
      fetchCape('wire').catch(() => null),
    ]);
    const items = [];
    const seen = new Set();
    const pushAll = (list, source) => {
      for (const raw of asArray(list)) {
        const item = normalizeSocialItem(raw, source);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    };
    pushAll(board?.flash_rumors || board?.social || [], 'board-wire');
    pushAll(social, 'social');
    pushAll(news, 'news');
    pushAll(wire, 'wire');
    items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return {
      count: items.length,
      items,
      sources: {
        board: Boolean(board),
        social: Boolean(social),
        news: Boolean(news),
        wire: Boolean(wire),
        firewire: Boolean(resolveUpstream()),
      },
      updatedAt: new Date(now()).toISOString(),
    };
  }

  function filterBody(body, { kind, enabledSources } = {}) {
    if (!body?.items) return body;
    let items = body.items;
    if (enabledSources && typeof enabledSources === 'object') {
      items = items.filter((item) => {
        const src = String(item.source || '');
        if (src === 'board-wire' || src.startsWith('board')) {
          return enabledSources.board !== false;
        }
        if (src === 'news') return enabledSources.news !== false;
        if (src === 'social') return enabledSources.social !== false;
        if (src === 'wire') return enabledSources.wire !== false;
        return true;
      });
    }
    if (kind === 'news') {
      items = items.filter((item) => {
        const src = String(item.source || '');
        return (
          src === 'news' ||
          src === 'board-wire' ||
          src.startsWith('board') ||
          src === 'wire'
        );
      });
    } else if (kind === 'social') {
      items = items.filter((item) => {
        const src = String(item.source || '');
        return src === 'social' || (!src.includes('news') && src !== 'wire');
      });
    }
    return {
      ...body,
      count: items.length,
      items,
      kind: kind || 'all',
    };
  }

  return async function socialHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });
    const url = new URL(req.url || '/', 'http://local');
    const kind = String(url.searchParams.get('kind') || '').toLowerCase();
    const key = 'social-feed';
    const t = now();
    const hit = cache.get(key);
    const apply = (body) =>
      filterBody(body, {
        kind: kind === 'news' || kind === 'social' ? kind : '',
      });
    if (hit && hit.exp > t) return json(res, 200, apply(hit.body));
    try {
      const { promise } = coalesceProxyRequest(inFlight, key, () => upstream());
      const body = await promise;
      cache.set(key, { exp: t + CACHE_TTL_MS, body });
      return json(res, 200, apply(body));
    } catch (error) {
      if (hit) return json(res, 200, { ...apply(hit.body), stale: true });
      return json(res, 502, {
        error: 'social_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
