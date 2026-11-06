/**
 * Fail-open reader for Cape Managers AI prompt overrides.
 * Voice / chat / HUD ask paths inject these when present; missing or
 * unreadable config → empty strings (defaults / stock instructions).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeManagerConfig } from './configDefaults.js';

const CACHE_TTL_MS = 15_000;
const EMPTY = Object.freeze({ briefOverride: '', askOverride: '' });

let cache = { ...EMPTY, at: 0 };
let inflight = null;

function defaultStorePath(env = process.env) {
  const override = String(env.CAPE_MANAGER_CONFIG_PATH || '').trim();
  if (override) return override;
  const root = String(
    env.GEV_CACHE_DIR || path.join(process.cwd(), '.gev-cache'),
  );
  return path.join(root, 'ops', 'manager-config.json');
}

function pick(raw) {
  const cfg = normalizeManagerConfig(raw && typeof raw === 'object' ? raw : {});
  return {
    briefOverride: String(cfg.ai?.briefOverride || '').trim(),
    askOverride: String(cfg.ai?.askOverride || '').trim(),
  };
}

/**
 * Read manager AI overrides from disk (or in-memory cache).
 * Never throws — returns empty overrides on any failure.
 */
export async function readAiOverrides({
  storePath = defaultStorePath(),
  now = Date.now,
  force = false,
} = {}) {
  const t = now();
  if (!force && t - cache.at < CACHE_TTL_MS) {
    return {
      briefOverride: cache.briefOverride,
      askOverride: cache.askOverride,
    };
  }
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const text = await readFile(storePath, 'utf8');
      const next = pick(JSON.parse(text));
      cache = { ...next, at: now() };
      return next;
    } catch {
      cache = { ...EMPTY, at: now() };
      return { ...EMPTY };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Sync peek of last successful (or empty) overrides — fail-open. */
export function peekAiOverrides() {
  return {
    briefOverride: cache.briefOverride,
    askOverride: cache.askOverride,
  };
}

/** Test helper — reset cache between cases. */
export function _resetAiOverridesCacheForTests() {
  cache = { ...EMPTY, at: 0 };
  inflight = null;
}

export { defaultStorePath as aiOverridesStorePath };
