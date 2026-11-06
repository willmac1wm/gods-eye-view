/**
 * LiveATC Icecast proxy + transcript store (old Cape Dispatch / Fire Wire pattern).
 * GET /api/ops/atc/stream|feeds|live|health — POST /api/ops/atc/ingest (manager).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { resolveManagerToken, tokensMatch } from './manager.js';
import {
  DEFAULT_ATC_MOUNTS,
  findMount,
  iceCastUrlForMount,
  resolveAllowedStreamUrl,
} from './atcMounts.js';
import { matchAtcAlerts, normalizeAtcAlertRules } from './atcAlerts.js';

const MAX_CHUNKS = 200;
const MAX_BODY = 256 * 1024;
const STREAM_UA =
  'VLC/3.0.18 LibVLC/3.0.18 CapeGEV-ATC/1.0 (Icecast proxy; ops desk)';

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
  const override = String(env.ATC_TRANSCRIPT_PATH || '').trim();
  if (override) return override;
  const root = String(
    env.GEV_CACHE_DIR || path.join(process.cwd(), '.gev-cache'),
  );
  return path.join(root, 'ops', 'atc-transcripts.json');
}

function ingestEnabled(env = process.env) {
  const v = String(env.ATC_LIVEATC_INGEST || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function createAtcLiveHandlers({
  resolveToken = resolveManagerToken,
  storePath = defaultStorePath(),
  getConfig = async () => null,
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  env = process.env,
} = {}) {
  let chunks = [];
  let loaded = false;
  let lastProbe = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 120, globalMax: 600 });

  async function ensureLoaded() {
    if (loaded) return chunks;
    try {
      const raw = await readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      chunks = Array.isArray(parsed?.chunks) ? parsed.chunks : [];
    } catch {
      chunks = [];
    }
    loaded = true;
    return chunks;
  }

  async function persist() {
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(
      storePath,
      JSON.stringify({ chunks: chunks.slice(-MAX_CHUNKS) }, null, 2),
      'utf8',
    );
  }

  async function mountsFromConfig() {
    const cfg = await getConfig().catch(() => null);
    const enabledMap = cfg?.sources?.liveatc?.mounts;
    return DEFAULT_ATC_MOUNTS.map((m) => {
      let enabled = m.enabled;
      if (enabledMap && typeof enabledMap === 'object') {
        if (typeof enabledMap[m.id] === 'boolean') enabled = enabledMap[m.id];
        else if (typeof enabledMap[m.mount] === 'boolean')
          enabled = enabledMap[m.mount];
      }
      if (cfg?.sources?.liveatc?.proxy === false) enabled = false;
      return { ...m, enabled };
    });
  }

  async function alertRules() {
    const cfg = await getConfig().catch(() => null);
    return normalizeAtcAlertRules(cfg?.ai?.atc || {});
  }

  async function appendChunk(entry) {
    await ensureLoaded();
    const rules = await alertRules();
    const { hits } = matchAtcAlerts(entry.transcript, rules);
    const row = {
      id: entry.id || randomUUID(),
      mount: entry.mount,
      started_at: entry.started_at || new Date(now()).toISOString(),
      duration_ms: entry.duration_ms ?? null,
      transcript: entry.transcript || null,
      audio_url: entry.audio_url || null,
      alerts: hits,
      source: entry.source || 'ingest',
    };
    chunks.push(row);
    if (chunks.length > MAX_CHUNKS) chunks = chunks.slice(-MAX_CHUNKS);
    await persist();
    return row;
  }

  /**
   * Lightweight activity probe when ATC_LIVEATC_INGEST=1 — pulls a short
   * Icecast sample so health shows live. Full STT is via POST /ingest or
   * tools/atc-liveatc-ingest.mjs (Whisper). Does not invent transcripts.
   */
  async function probeMount(mountEntry) {
    const url = iceCastUrlForMount(mountEntry.mount);
    if (!url) return { ok: false, error: 'bad_mount' };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const response = await fetchImpl(url, {
        headers: {
          'User-Agent': STREAM_UA,
          Accept: '*/*',
          'Icy-MetaData': '1',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        return { ok: false, error: `upstream_${response.status}` };
      }
      // Read a tiny prefix to prove the mount is live, then abort.
      const reader = response.body?.getReader?.();
      if (reader) {
        await reader.read();
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.name || 'fetch_failed' };
    }
  }

  let probeTimer = null;
  function startBackgroundProbe() {
    if (!ingestEnabled(env) || probeTimer) return;
    const tick = async () => {
      const mounts = (await mountsFromConfig()).filter((m) => m.enabled);
      const results = [];
      for (const m of mounts.slice(0, 3)) {
        const r = await probeMount(m);
        results.push({ id: m.id, ...r });
      }
      lastProbe = {
        at: new Date(now()).toISOString(),
        results,
        ingest: true,
      };
    };
    void tick();
    probeTimer = setInterval(() => void tick(), 120_000);
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
  }

  async function handleStream(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!admitSameSiteKeyless(req, res)) return;
    const key = clientKey(req);
    if (!allow(key)) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const mountId = url.searchParams.get('mount') || '';
    const catalog = await mountsFromConfig();
    const upstream = resolveAllowedStreamUrl(mountId, catalog);
    if (!upstream) {
      json(res, 404, { error: 'mount_not_allowed', mount: mountId });
      return;
    }

    try {
      const upstreamRes = await fetchImpl(upstream, {
        headers: {
          'User-Agent': STREAM_UA,
          Accept: '*/*',
          'Icy-MetaData': '1',
        },
      });
      if (!upstreamRes.ok || !upstreamRes.body) {
        json(res, 502, {
          error: 'liveatc_upstream',
          status: upstreamRes.status,
        });
        return;
      }
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        upstreamRes.headers.get('content-type') || 'audio/mpeg',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('icy-name', upstreamRes.headers.get('icy-name') || mountId);
      const reader = upstreamRes.body.getReader();
      const pump = async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(Buffer.from(value))) {
              await new Promise((resolve) => res.once('drain', resolve));
            }
          }
          res.end();
        } catch {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
      };
      req.on('close', () => {
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
      });
      void pump();
    } catch (error) {
      json(res, 502, {
        error: 'liveatc_proxy_failed',
        detail: String(error?.message || error),
      });
    }
  }

  async function handleFeeds(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const mounts = await mountsFromConfig();
    json(res, 200, {
      feeds: mounts.map((m) => ({
        feed_id: m.id,
        mount: m.mount,
        icao: m.icao,
        name: m.label,
        enabled: m.enabled,
        live: Boolean(m.enabled),
        stream_url: m.enabled
          ? `/api/ops/atc/stream?mount=${encodeURIComponent(m.mount)}`
          : null,
        search_url: `https://www.liveatc.net/search/?icao=${encodeURIComponent(m.icao)}`,
      })),
      policy: 'icecast_proxy',
      ingest: ingestEnabled(env),
    });
  }

  async function handleLive(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    await ensureLoaded();
    const url = new URL(req.url || '/', 'http://localhost');
    const mount = url.searchParams.get('mount');
    const limit = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get('limit')) || 20),
    );
    let list = [...chunks].reverse();
    if (mount) {
      const id = mount.toLowerCase();
      list = list.filter(
        (c) => c.mount === id || findMount(c.mount)?.id === id,
      );
    }
    const rules = await alertRules();
    json(res, 200, {
      chunks: list.slice(0, limit),
      alerts: list
        .flatMap((c) =>
          (c.alerts || []).map((a) => ({ ...a, chunk_id: c.id, mount: c.mount })),
        )
        .slice(0, 30),
      rules: {
        enabled: rules.enabled,
        cooldownSec: rules.cooldownSec,
      },
      probe: lastProbe,
      quiet: list.length === 0,
    });
  }

  async function handleHealth(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    await ensureLoaded();
    const mounts = await mountsFromConfig();
    json(res, 200, {
      proxy: true,
      ingest: ingestEnabled(env),
      mounts: mounts.length,
      enabled: mounts.filter((m) => m.enabled).length,
      chunks: chunks.length,
      probe: lastProbe,
    });
  }

  async function handleIngest(req, res) {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const expected = resolveToken(env);
    const got = bearerFrom(req);
    if (!expected || !tokensMatch(got, expected)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const mount = String(body.mount || body.feed_id || '').trim();
      if (!findMount(mount)) {
        json(res, 400, { error: 'mount_not_allowed' });
        return;
      }
      const row = await appendChunk({
        mount: findMount(mount).mount,
        transcript: body.transcript != null ? String(body.transcript) : null,
        started_at: body.started_at,
        duration_ms: body.duration_ms,
        audio_url: body.audio_url
          ? `/api/ops/atc/stream?mount=${encodeURIComponent(findMount(mount).mount)}`
          : null,
        source: body.source || 'worker',
      });
      json(res, 200, { ok: true, chunk: row });
    } catch (error) {
      if (error?.code === 'body_too_large') {
        json(res, 413, { error: 'body_too_large' });
        return;
      }
      json(res, 400, { error: 'bad_json' });
    }
  }

  startBackgroundProbe();

  return {
    handleStream,
    handleFeeds,
    handleLive,
    handleHealth,
    handleIngest,
    appendChunk,
    /** Test helper */
    _state: () => ({ chunks, lastProbe }),
  };
}
