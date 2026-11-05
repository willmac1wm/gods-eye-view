import { timingSafeEqual } from 'node:crypto';
import {
  isRetiredCapeWebsite,
  resolveCapeUpstream,
} from '../capeUpstream.js';
import { readResponseBytesCapped } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4 * 1024 * 1024;

/** Read-only manager paths on Fire Wire — never uploads / evidence / push. */
export const MANAGER_ALLOW = [
  /^status$/,
  /^health$/,
  /^summary$/,
  /^queue$/,
  /^doctrine$/,
  /^review(\/[\w.-]+)?$/,
  /^members$/,
  /^roster$/,
  /^moderation(\/[\w.-]+)?$/,
];

const MANAGER_DENY =
  /(^|\/)(uploads|evidence|push|billing|password|secret|token|key)(\/|$)/i;

export function managerAllowed(path) {
  const p = String(path || '').replace(/^\/+/, '');
  return (
    !MANAGER_DENY.test(p) &&
    !p.includes('..') &&
    MANAGER_ALLOW.some((re) => re.test(p))
  );
}

export function resolveManagerToken(env = process.env) {
  const raw = String(
    env.CAPE_MANAGER_TOKEN || env.FIREWIRE_MANAGER_TOKEN || '',
  ).trim();
  return raw || null;
}

export function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerFrom(req) {
  const header = String(req.headers?.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(header);
  // Bearer only — never accept ?token= (leaks into logs / Referer).
  return m ? m[1].trim() : '';
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Auth-gated Cape manager proxy.
 * - GET /api/ops/manager/session → {ok} when Bearer matches CAPE_MANAGER_TOKEN
 * - GET /api/ops/manager/<path> → Fire Wire /api/manager/<path> (allowlisted)
 */
export function createManagerHandlers({
  fetchImpl = (...args) => globalThis.fetch(...args),
  resolveUpstream = resolveCapeUpstream,
  resolveToken = resolveManagerToken,
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });

  function requireAuth(req, res) {
    const expected = resolveToken();
    if (!expected) {
      json(res, 503, {
        error: 'manager_unconfigured',
        detail:
          'Set CAPE_MANAGER_TOKEN (or FIREWIRE_MANAGER_TOKEN) on the GEV host.',
      });
      return null;
    }
    const provided = bearerFrom(req);
    if (!tokensMatch(expected, provided)) {
      json(res, 401, { error: 'unauthorized' });
      return null;
    }
    return expected;
  }

  async function sessionHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    const expected = resolveToken();
    if (!expected) {
      return json(res, 503, {
        error: 'manager_unconfigured',
        detail:
          'Set CAPE_MANAGER_TOKEN (or FIREWIRE_MANAGER_TOKEN) on the GEV host.',
        configured: false,
      });
    }
    const provided = bearerFrom(req);
    if (!provided) {
      return json(res, 200, { configured: true, authenticated: false });
    }
    if (!tokensMatch(expected, provided)) {
      return json(res, 401, { error: 'unauthorized', configured: true });
    }
    return json(res, 200, {
      configured: true,
      authenticated: true,
      tools: MANAGER_ALLOW.map((re) => String(re)),
    });
  }

  async function proxyHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) return json(res, 429, { error: 'rate_limited' });
    if (!requireAuth(req, res)) return;

    const url = new URL(req.url || '/', 'http://local');
    const path = url.pathname.replace(/^\/+/, '');
    if (!managerAllowed(path)) {
      return json(res, 403, {
        error: 'manager_path_not_allowlisted',
        path,
      });
    }

    const base = resolveUpstream();
    if (!base) {
      return json(res, 503, {
        error: 'firewire_unconfigured',
        detail: 'Set FIREWIRE_URL for manager upstream.',
      });
    }
    if (isRetiredCapeWebsite(base)) {
      return json(res, 503, {
        error: 'cape_website_retired',
        detail: 'Point FIREWIRE_URL at the Fire Wire API host.',
      });
    }

    try {
      const upstream = new URL(`/api/manager/${path}`, `${base}/`);
      upstream.search = url.search;
      // Drop client token from upstream query if present.
      upstream.searchParams.delete('token');
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const response = await fetchImpl(upstream, {
        method: 'GET',
        signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${resolveToken()}`,
        },
      });
      const bytes = await readResponseBytesCapped(response, MAX_BYTES, signal);
      const type = response.headers.get('content-type') || 'application/json';
      res.statusCode = response.status;
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Ops-Manager', '1');
      return res.end(
        req.method === 'HEAD'
          ? undefined
          : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    } catch (error) {
      return json(res, 502, {
        error: 'manager_upstream_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return { sessionHandler, proxyHandler };
}
