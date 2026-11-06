/**
 * LiveATC Icecast proxy + transcript store (old Cape Dispatch / Fire Wire pattern).
 * GET /api/ops/atc/stream|feeds|live|health — POST /api/ops/atc/ingest (same-site).
 *
 * Upstream policy: one fixed browser User-Agent, one Icecast fetch at a time,
 * cache feeds/health, back off slowly on 403/429 (no UA rotation / host hopping).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  DEFAULT_ATC_MOUNTS,
  findMount,
  iceCastUrlForMount,
  resolveAllowedStreamUrl,
} from './atcMounts.js';
import { matchAtcAlerts, normalizeAtcAlertRules } from './atcAlerts.js';

const MAX_CHUNKS = 200;
const MAX_BODY = 256 * 1024;
const FEEDS_CACHE_TTL_MS = 30_000;
const HEALTH_CACHE_TTL_MS = 15_000;
/** Slow retry after LiveATC 403/429 — do not hammer. */
export const LIVEATC_BACKOFF_MS = 20 * 60 * 1000;

/**
 * Fixed desktop Chrome UA — looks like a normal browser, never rotated.
 */
export const STREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function json(res, status, body, { cacheTtlMs = 0 } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheTtlMs > 0) {
    res.setHeader(
      'Cache-Control',
      `private, max-age=${Math.floor(cacheTtlMs / 1000)}`,
    );
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
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
  const override = String(env.ATC_TRANSCRIPT_PATH || '').trim();
  if (override) return override;
  const root = String(
    env.GEV_CACHE_DIR || path.join(process.cwd(), '.gev-cache'),
  );
  return path.join(root, 'ops', 'atc-transcripts.json');
}

function openaiKey(env = process.env) {
  return String(env.OPENAI_API_KEY || '').trim();
}

/**
 * Ingest / Whisper loop gate.
 * Explicit ATC_LIVEATC_INGEST=0|false|off|no disables.
 * Explicit 1|true|yes|on enables.
 * Unset defaults to on when OPENAI_API_KEY is present (in-process Whisper).
 */
export function ingestEnabled(env = process.env) {
  const v = String(env.ATC_LIVEATC_INGEST || '')
    .trim()
    .toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  return Boolean(openaiKey(env));
}

export function whisperModel(env = process.env) {
  const model = String(env.ATC_WHISPER_MODEL || '').trim();
  return model || 'whisper-1';
}

function snippetFromBody(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function createAtcLiveHandlers({
  storePath = defaultStorePath(),
  getConfig = async () => null,
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
  env = process.env,
  backoffMs = LIVEATC_BACKOFF_MS,
} = {}) {
  let chunks = [];
  let loaded = false;
  let lastProbe = null;
  /** @type {{ status: number, statusText: string, bodySnippet: string, at: string, until: number } | null} */
  let blockState = null;
  /** When true, in-page Icecast proxy is refused — link-outs only. */
  let linkOutOnly = false;
  /** @type {{ kind: string, mount: string } | null} */
  let activeUpstream = null;
  /** @type {Array<() => void>} */
  const upstreamWaiters = [];
  let feedsCache = null;
  let healthCache = null;
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

  function inBackoff() {
    return Boolean(blockState && blockState.until > now());
  }

  function releaseUpstream() {
    activeUpstream = null;
    const next = upstreamWaiters.shift();
    if (next) next();
  }

  async function acquireUpstream(kind, mount) {
    if (inBackoff()) {
      const err = new Error('liveatc_backoff');
      err.code = 'liveatc_backoff';
      err.block = blockState;
      throw err;
    }
    while (activeUpstream) {
      await new Promise((resolve) => {
        upstreamWaiters.push(resolve);
      });
      if (inBackoff()) {
        const err = new Error('liveatc_backoff');
        err.code = 'liveatc_backoff';
        err.block = blockState;
        throw err;
      }
    }
    activeUpstream = { kind, mount: String(mount || '') };
  }

  /**
   * Serialize all LiveATC Icecast traffic — never parallel/burst.
   * Short samples use this; Listen streams acquire/release around the session.
   */
  async function withUpstreamSlot(kind, mount, fn) {
    await acquireUpstream(kind, mount);
    try {
      return await fn();
    } finally {
      releaseUpstream();
    }
  }

  let probeTimer = null;
  let backoffTimer = null;

  function stopProbe() {
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
  }

  function recordUpstreamBlock(status, statusText, bodySnippet) {
    blockState = {
      status: Number(status) || 0,
      statusText: String(statusText || ''),
      bodySnippet: snippetFromBody(bodySnippet),
      at: new Date(now()).toISOString(),
      until: now() + backoffMs,
    };
    linkOutOnly = true;
    stopProbe();
    feedsCache = null;
    healthCache = null;
    if (backoffTimer) clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => {
      // Slow retry: clear backoff clock; keep linkOutOnly until a probe succeeds.
      blockState = blockState ? { ...blockState, until: 0 } : null;
      if (ingestEnabled(env)) startBackgroundProbe({ force: true });
    }, backoffMs);
    if (typeof backoffTimer.unref === 'function') backoffTimer.unref();
  }

  async function readErrorSnippet(response) {
    try {
      const text = await response.text();
      return snippetFromBody(text);
    } catch {
      return '';
    }
  }

  function looksLikeHtmlBlock(snippet) {
    const s = String(snippet || '').toLowerCase();
    return (
      s.includes('<html') ||
      s.includes('access denied') ||
      s.includes('terms of service') ||
      s.includes('tos') ||
      s.includes('forbidden') ||
      s.includes('cloudflare')
    );
  }

  /**
   * Pull a short Icecast sample (bytes) for activity probe / Whisper.
   * Does not invent transcripts.
   */
  async function sampleMountBytes(mountEntry, { maxBytes = 96_000 } = {}) {
    const url = iceCastUrlForMount(mountEntry.mount);
    if (!url) return { ok: false, error: 'bad_mount' };
    try {
      return await withUpstreamSlot('sample', mountEntry.mount, async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12_000);
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
          const bodySnippet = await readErrorSnippet(response);
          if (response.status === 403 || response.status === 429) {
            recordUpstreamBlock(
              response.status,
              response.statusText,
              bodySnippet,
            );
          }
          return {
            ok: false,
            error: `upstream_${response.status}`,
            status: response.status,
            bodySnippet,
          };
        }
        // Successful audio clears ToS/link-out lock from a prior block.
        if (linkOutOnly) {
          linkOutOnly = false;
          blockState = null;
          feedsCache = null;
          healthCache = null;
        }
        const reader = response.body?.getReader?.();
        if (!reader) return { ok: true, bytes: Buffer.alloc(0) };
        const parts = [];
        let size = 0;
        while (size < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(Buffer.from(value));
          size += value.length;
        }
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { ok: true, bytes: Buffer.concat(parts) };
      });
    } catch (error) {
      if (error?.code === 'liveatc_backoff') {
        return {
          ok: false,
          error: 'liveatc_backoff',
          status: error.block?.status,
          bodySnippet: error.block?.bodySnippet,
        };
      }
      const causeCode = error?.cause?.code || error?.code || '';
      const detail = String(
        error?.cause?.message ||
          error?.message ||
          error?.name ||
          'fetch_failed',
      );
      // Datacenter / TLS resets from LiveATC edge — report exact cause, back off.
      if (
        causeCode === 'ECONNRESET' ||
        causeCode === 'ECONNREFUSED' ||
        causeCode === 'ETIMEDOUT' ||
        causeCode === 'ENOTFOUND'
      ) {
        recordUpstreamBlock(0, causeCode || 'network', detail);
        return {
          ok: false,
          error: 'liveatc_network',
          status: 0,
          bodySnippet: `${causeCode}: ${detail}`,
        };
      }
      return {
        ok: false,
        error: error?.name || 'fetch_failed',
        bodySnippet: detail,
      };
    }
  }

  async function probeMount(mountEntry) {
    const sample = await sampleMountBytes(mountEntry, { maxBytes: 8_192 });
    if (!sample.ok) return sample;
    return { ok: true };
  }

  /**
   * OpenAI Whisper transcription for one audio buffer. Returns null on failure
   * (quiet UI — never invents text).
   */
  async function transcribeWithWhisper(bytes, mountId) {
    const key = openaiKey(env);
    if (!key || !bytes?.length) return null;
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([Uint8Array.from(bytes)], { type: 'audio/mpeg' }),
        `${mountId || 'atc'}.mp3`,
      );
      form.append('model', whisperModel(env));
      const response = await fetchImpl(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok) {
        try {
          await response.body?.cancel?.();
        } catch {
          /* ignore */
        }
        return null;
      }
      const payload = await response.json();
      const text = String(payload?.text || '').trim();
      return text || null;
    } catch {
      return null;
    }
  }

  function startBackgroundProbe({ force = false } = {}) {
    if (!ingestEnabled(env)) return;
    if (probeTimer && !force) return;
    if (force) stopProbe();
    if (inBackoff()) return;

    const tick = async () => {
      if (inBackoff() || (linkOutOnly && blockState)) {
        // During ToS lock with active block record, skip until backoff clears.
        if (inBackoff()) return;
      }
      const mounts = (await mountsFromConfig()).filter((m) => m.enabled);
      const results = [];
      const keyPresent = Boolean(openaiKey(env));
      // One mount per tick — never burst across mounts in a single wave.
      for (const m of mounts.slice(0, 3)) {
        if (inBackoff()) break;
        if (keyPresent) {
          const sample = await sampleMountBytes(m);
          if (!sample.ok) {
            results.push({
              id: m.id,
              ok: false,
              error: sample.error,
              status: sample.status,
            });
            if (sample.status === 403 || sample.status === 429) break;
            continue;
          }
          const transcript = await transcribeWithWhisper(sample.bytes, m.id);
          results.push({
            id: m.id,
            ok: true,
            transcribed: Boolean(transcript),
          });
          if (transcript) {
            await appendChunk({
              mount: m.mount,
              transcript,
              duration_ms: null,
              audio_url: `/api/ops/atc/stream?mount=${encodeURIComponent(m.mount)}`,
              source: 'whisper-inprocess',
            });
          }
        } else {
          const r = await probeMount(m);
          results.push({ id: m.id, ...r });
          if (r.status === 403 || r.status === 429) break;
        }
        // Pause between mounts so we never look like a parallel burst.
        await new Promise((r) => setTimeout(r, 2_500));
      }
      lastProbe = {
        at: new Date(now()).toISOString(),
        results,
        ingest: true,
        whisper: keyPresent,
        linkOutOnly,
        block: blockState,
      };
      healthCache = null;
    };
    void tick();
    // Whisper samples are heavier than a tiny probe — 3 minutes when keyed.
    const intervalMs = openaiKey(env) ? 180_000 : 120_000;
    probeTimer = setInterval(() => void tick(), intervalMs);
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
  }

  function policyPayload() {
    if (linkOutOnly || inBackoff()) return 'link_out_only';
    return 'icecast_proxy';
  }

  function blockPayload() {
    if (!blockState) return null;
    return {
      status: blockState.status,
      statusText: blockState.statusText,
      bodySnippet: blockState.bodySnippet,
      at: blockState.at,
      until: new Date(blockState.until).toISOString(),
      backoff_ms: Math.max(0, blockState.until - now()),
    };
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
    if (admitSameSiteKeyless(req, res)) return;
    const key = clientKey(req);
    if (!allow(key)) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }

    if (inBackoff() || linkOutOnly) {
      json(res, 503, {
        error: 'liveatc_blocked',
        policy: 'link_out_only',
        block: blockPayload(),
        detail:
          'LiveATC refused or rate-limited the proxy. Use external LiveATC links; do not retry rapidly.',
      });
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

    let slotHeld = false;
    try {
      await acquireUpstream('stream', mountId);
      slotHeld = true;
      const upstreamRes = await fetchImpl(upstream, {
        headers: {
          'User-Agent': STREAM_UA,
          Accept: '*/*',
          'Icy-MetaData': '1',
        },
      });
      if (!upstreamRes.ok || !upstreamRes.body) {
        const bodySnippet = await readErrorSnippet(upstreamRes);
        releaseUpstream();
        slotHeld = false;
        if (upstreamRes.status === 403 || upstreamRes.status === 429) {
          recordUpstreamBlock(
            upstreamRes.status,
            upstreamRes.statusText,
            bodySnippet,
          );
          json(res, 503, {
            error: 'liveatc_blocked',
            policy: 'link_out_only',
            block: blockPayload(),
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            bodySnippet,
          });
          return;
        }
        if (
          looksLikeHtmlBlock(bodySnippet) &&
          String(upstreamRes.headers.get('content-type') || '').includes(
            'text/html',
          )
        ) {
          recordUpstreamBlock(
            upstreamRes.status,
            upstreamRes.statusText,
            bodySnippet,
          );
          json(res, 503, {
            error: 'liveatc_blocked',
            policy: 'link_out_only',
            block: blockPayload(),
            status: upstreamRes.status,
            bodySnippet,
          });
          return;
        }
        json(res, 502, {
          error: 'liveatc_upstream',
          status: upstreamRes.status,
          statusText: upstreamRes.statusText,
          bodySnippet,
        });
        return;
      }

      linkOutOnly = false;
      blockState = null;
      feedsCache = null;
      healthCache = null;

      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        upstreamRes.headers.get('content-type') || 'audio/mpeg',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('icy-name', upstreamRes.headers.get('icy-name') || mountId);
      const reader = upstreamRes.body.getReader();
      const hold = activeUpstream;
      let finished = false;
      const finishSlot = () => {
        if (finished) return;
        finished = true;
        if (activeUpstream === hold) releaseUpstream();
        slotHeld = false;
      };
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
        } finally {
          finishSlot();
        }
      };
      req.on('close', () => {
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
        finishSlot();
      });
      void pump();
      // Slot released by pump/close — do not release here.
      slotHeld = false;
    } catch (error) {
      if (slotHeld) releaseUpstream();
      if (error?.code === 'liveatc_backoff') {
        json(res, 503, {
          error: 'liveatc_blocked',
          policy: 'link_out_only',
          block: blockPayload(),
        });
        return;
      }
      const causeCode = error?.cause?.code || error?.code || '';
      const detail = String(
        error?.cause?.message || error?.message || error || 'fetch_failed',
      );
      if (
        causeCode === 'ECONNRESET' ||
        causeCode === 'ECONNREFUSED' ||
        causeCode === 'ETIMEDOUT' ||
        causeCode === 'ENOTFOUND'
      ) {
        recordUpstreamBlock(0, causeCode || 'network', detail);
        if (!res.headersSent) {
          json(res, 503, {
            error: 'liveatc_blocked',
            policy: 'link_out_only',
            block: blockPayload(),
            detail: `${causeCode}: ${detail}`,
          });
        }
        return;
      }
      if (!res.headersSent) {
        json(res, 502, {
          error: 'liveatc_proxy_failed',
          detail,
          cause: causeCode || undefined,
        });
      }
    }
  }

  async function buildFeedsBody() {
    const mounts = await mountsFromConfig();
    const policy = policyPayload();
    const proxyOk = policy === 'icecast_proxy';
    return {
      feeds: mounts.map((m) => ({
        feed_id: m.id,
        mount: m.mount,
        icao: m.icao,
        name: m.label,
        enabled: m.enabled,
        live: Boolean(m.enabled) && proxyOk,
        stream_url:
          m.enabled && proxyOk
            ? `/api/ops/atc/stream?mount=${encodeURIComponent(m.mount)}`
            : null,
        search_url: `https://www.liveatc.net/search/?icao=${encodeURIComponent(m.icao)}`,
      })),
      policy,
      block: blockPayload(),
      ingest: ingestEnabled(env),
      userAgent: 'browser',
    };
  }

  async function handleFeeds(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const t = now();
    if (feedsCache && t - feedsCache.at < FEEDS_CACHE_TTL_MS) {
      json(res, 200, feedsCache.body, { cacheTtlMs: FEEDS_CACHE_TTL_MS });
      return;
    }
    const body = await buildFeedsBody();
    feedsCache = { at: t, body };
    json(res, 200, body, { cacheTtlMs: FEEDS_CACHE_TTL_MS });
  }

  async function handleLive(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
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
          (c.alerts || []).map((a) => ({
            ...a,
            chunk_id: c.id,
            mount: c.mount,
          })),
        )
        .slice(0, 30),
      rules: {
        enabled: rules.enabled,
        cooldownSec: rules.cooldownSec,
      },
      probe: lastProbe,
      quiet: list.length === 0,
      policy: policyPayload(),
      block: blockPayload(),
    });
  }

  async function buildHealthBody() {
    await ensureLoaded();
    const mounts = await mountsFromConfig();
    const policy = policyPayload();
    return {
      proxy: policy === 'icecast_proxy',
      policy,
      block: blockPayload(),
      ingest: ingestEnabled(env),
      mounts: mounts.length,
      enabled: mounts.filter((m) => m.enabled).length,
      chunks: chunks.length,
      probe: lastProbe,
      activeUpstream: activeUpstream
        ? { kind: activeUpstream.kind, mount: activeUpstream.mount }
        : null,
      userAgent: 'browser',
    };
  }

  async function handleHealth(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const t = now();
    if (healthCache && t - healthCache.at < HEALTH_CACHE_TTL_MS) {
      json(res, 200, healthCache.body, { cacheTtlMs: HEALTH_CACHE_TTL_MS });
      return;
    }
    const body = await buildHealthBody();
    healthCache = { at: t, body };
    json(res, 200, body, { cacheTtlMs: HEALTH_CACHE_TTL_MS });
  }

  async function handleIngest(req, res) {
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method_not_allowed' });
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
    sampleMountBytes,
    transcribeWithWhisper,
    STREAM_UA,
    /** Test helper */
    _state: () => ({
      chunks,
      lastProbe,
      blockState,
      linkOutOnly,
      activeUpstream,
      feedsCache,
      healthCache,
    }),
  };
}
