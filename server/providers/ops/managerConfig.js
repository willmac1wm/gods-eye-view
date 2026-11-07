import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  defaultManagerConfig,
  normalizeManagerConfig,
} from './configDefaults.js';

const MAX_BODY = 256 * 1024;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req, maxBytes = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('body_too_large');
      err.code = 'body_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return '';
  return Buffer.concat(chunks).toString('utf8');
}

function defaultStorePath(env = process.env) {
  const override = String(env.CAPE_MANAGER_CONFIG_PATH || '').trim();
  if (override) return override;
  const root = String(
    env.GEV_CACHE_DIR || path.join(process.cwd(), '.gev-cache'),
  );
  return path.join(root, 'ops', 'manager-config.json');
}

/**
 * File-backed manager config with in-memory cache.
 * GET/PUT/PATCH are same-site ungated (Managers is in-app; no token).
 */
export function createManagerConfigHandlers({
  storePath = defaultStorePath(),
  now = () => Date.now(),
} = {}) {
  let memory = normalizeManagerConfig(defaultManagerConfig());
  let loaded = false;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 120, globalMax: 600 });

  async function ensureLoaded() {
    if (loaded) return memory;
    try {
      const raw = await readFile(storePath, 'utf8');
      memory = normalizeManagerConfig(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        /* corrupt / unreadable → defaults */
      }
      memory = normalizeManagerConfig(defaultManagerConfig());
    }
    loaded = true;
    return memory;
  }

  async function persist(next) {
    memory = normalizeManagerConfig({
      ...next,
      updatedAt: new Date(now()).toISOString(),
    });
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(storePath, JSON.stringify(memory, null, 2), 'utf8');
    return memory;
  }

  async function getHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD, PUT, PATCH');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });
    const config = await ensureLoaded();
    return json(res, 200, {
      ok: true,
      config,
      defaults: defaultManagerConfig(),
    });
  }

  async function writeHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'PUT' && req.method !== 'PATCH') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD, PUT, PATCH');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });

    let body;
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : {};
    } catch (error) {
      if (error?.code === 'body_too_large') {
        return json(res, 413, { error: 'body_too_large' });
      }
      return json(res, 400, { error: 'invalid_json' });
    }

    const incoming =
      body.config && typeof body.config === 'object' ? body.config : body;
    const current = await ensureLoaded();
    const merged =
      req.method === 'PATCH'
        ? {
            ...current,
            ...incoming,
            intervalsMs: { ...current.intervalsMs, ...incoming.intervalsMs },
            viewability: { ...current.viewability, ...incoming.viewability },
            placeSections: {
              ...current.placeSections,
              ...incoming.placeSections,
            },
            sources: {
              social: {
                ...current.sources.social,
                ...incoming.sources?.social,
              },
              place: { ...current.sources.place, ...incoming.sources?.place },
              board: { ...current.sources.board, ...incoming.sources?.board },
            },
            globe: {
              ...current.globe,
              ...incoming.globe,
              stripSections: {
                ...current.globe.stripSections,
                ...incoming.globe?.stripSections,
              },
              layers: { ...current.globe.layers, ...incoming.globe?.layers },
            },
            approvals: { ...current.approvals, ...incoming.approvals },
            permissions: { ...current.permissions, ...incoming.permissions },
            ai: { ...current.ai, ...incoming.ai },
          }
        : incoming;

    try {
      const config = await persist(merged);
      return json(res, 200, { ok: true, config });
    } catch (error) {
      return json(res, 500, {
        error: 'config_persist_failed',
        detail: String(error?.message || error),
      });
    }
  }

  async function handler(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return getHandler(req, res);
    }
    return writeHandler(req, res);
  }

  return {
    handler,
    /** Test / strip helpers */
    async getConfig() {
      return ensureLoaded();
    },
    async setConfig(next) {
      return persist(next);
    },
  };
}
