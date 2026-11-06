import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { resolveManagerToken, tokensMatch } from './manager.js';

const MAX_BODY = 64 * 1024;
const MAX_MESSAGES = 200;
const MAX_TEXT = 2_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function bearerFrom(req) {
  const header = String(req.headers?.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : '';
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
  const override = String(env.CAPE_OPS_MESSAGES_PATH || '').trim();
  if (override) return override;
  const root = String(
    env.GEV_CACHE_DIR || path.join(process.cwd(), '.gev-cache'),
  );
  return path.join(root, 'ops', 'messages.json');
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * Operator messaging desk — file-backed ring buffer.
 * GET is keyless; POST may require manager token when
 * `requireManagerForMessages` is set (checked by caller via config).
 */
export function createMessagesHandlers({
  resolveToken = resolveManagerToken,
  storePath = defaultStorePath(),
  now = () => Date.now(),
  requireManagerForWrite = async () => false,
} = {}) {
  let messages = [];
  let loaded = false;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 450 });

  async function ensureLoaded() {
    if (loaded) return messages;
    try {
      const raw = await readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
    } catch {
      messages = [];
    }
    loaded = true;
    return messages;
  }

  async function persist() {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(
      storePath,
      JSON.stringify({ messages: messages.slice(-MAX_MESSAGES) }, null, 2),
      'utf8',
    );
  }

  async function listHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD, POST');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });
    const list = await ensureLoaded();
    return json(res, 200, {
      ok: true,
      count: list.length,
      messages: list.slice(-100),
    });
  }

  async function postHandler(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD, POST');
      return res.end();
    }
    if (!allow(clientKey(req)))
      return json(res, 429, { error: 'rate_limited' });

    const needAuth = await requireManagerForWrite();
    if (needAuth) {
      const expected = resolveToken();
      if (!expected) {
        return json(res, 503, { error: 'manager_unconfigured' });
      }
      if (!tokensMatch(expected, bearerFrom(req))) {
        return json(res, 401, { error: 'unauthorized' });
      }
    }

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

    const from = sanitizeText(body.from || body.author || 'operator').slice(
      0,
      64,
    );
    const text = sanitizeText(body.text || body.body || body.message);
    if (!text) return json(res, 400, { error: 'empty_message' });

    await ensureLoaded();
    const entry = {
      id: randomUUID(),
      from: from || 'operator',
      text,
      at: new Date(now()).toISOString(),
    };
    messages = [...messages, entry].slice(-MAX_MESSAGES);
    try {
      await persist();
    } catch (error) {
      return json(res, 500, {
        error: 'messages_persist_failed',
        detail: String(error?.message || error),
      });
    }
    return json(res, 201, { ok: true, message: entry });
  }

  async function handler(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return listHandler(req, res);
    }
    return postHandler(req, res);
  }

  return {
    handler,
    async list() {
      return ensureLoaded();
    },
  };
}
