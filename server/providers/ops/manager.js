import { timingSafeEqual } from 'node:crypto';
import { isRetiredCapeWebsite, resolveCapeUpstream } from '../capeUpstream.js';
import { quietManagerPayload } from '../capeQuietStore.js';
import { readResponseBytesCapped } from '../common/http.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4 * 1024 * 1024;

/** Read-only manager paths — never uploads / evidence / push. */
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

/** @deprecated Token gate removed — Managers is in-app and ungated. */
export function resolveManagerToken(env = process.env) {
  const raw = String(
    env.CAPE_MANAGER_TOKEN || env.FIREWIRE_MANAGER_TOKEN || '',
  ).trim();
  return raw || null;
}

/** @deprecated Kept for messages optional gate / legacy tests. */
export function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * In-app Managers — no CAPE_MANAGER_TOKEN unlock.
 * - GET /api/ops/manager/session → always configured + authenticated
 * - GET /api/ops/manager/<path> → optional upstream, else in-app quiet stub
 */
export function createManagerHandlers({
  fetchImpl = (...args) => globalThis.fetch(...args),
  resolveUpstream = resolveCapeUpstream,
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });

  async function sessionHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, {
      configured: true,
      authenticated: true,
      mode: 'inapp',
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
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });

    const url = new URL(req.url || '/', 'http://local');
    const path = url.pathname.replace(/^\/+/, '');
    if (!managerAllowed(path)) {
      return json(res, 403, {
        error: 'manager_path_not_allowlisted',
        path,
      });
    }

    const base = resolveUpstream();
    if (!base || isRetiredCapeWebsite(base)) {
      return json(res, 200, quietManagerPayload(path));
    }

    try {
      const upstream = new URL(`/api/manager/${path}`, `${base}/`);
      upstream.search = url.search;
      upstream.searchParams.delete('token');
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      const response = await fetchImpl(upstream, {
        method: 'GET',
        signal,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
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
      // Upstream optional — fall back to in-app quiet stub.
      return json(res, 200, {
        ...quietManagerPayload(path),
        detail: `Upstream unavailable (${String(error?.message || error)}); in-app quiet stub.`,
      });
    }
  }

  return { sessionHandler, proxyHandler };
}
