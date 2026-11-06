// Same-origin Cape proxy. Cape owns provider keys, including TomTom.
import { isCapeSourceFresh } from './model.js';

const HEALTH_TTL_MS = 30_000;
let _healthCache = null;
let _healthAt = 0;
let _healthInflight = null;

export async function capeJson(path, { signal } = {}) {
  const response = await fetch(`/api/cape/${path}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    const error = new Error(`cape-${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** Null when a path is down; other failures still reject. */
export async function capeJsonOptional(path, options) {
  try {
    return await capeJson(path, options);
  } catch (error) {
    if (error?.status) return null;
    throw error;
  }
}

/**
 * Shared `/api/cape/health/sources` snapshot (cached 30 s) so layers and the
 * status strip do not hammer the health endpoint on simultaneous refreshes.
 */
export async function getCapeHealth({ signal } = {}) {
  const now = Date.now();
  if (_healthCache && now - _healthAt < HEALTH_TTL_MS) return _healthCache;
  if (!_healthInflight) {
    _healthInflight = capeJsonOptional('health/sources', { signal })
      .then((payload) => {
        if (payload && Array.isArray(payload.sources)) {
          _healthCache = Object.fromEntries(
            payload.sources
              .filter((source) => source?.key)
              .map((source) => [source.key, source]),
          );
          _healthAt = Date.now();
        }
        return _healthCache;
      })
      .finally(() => {
        _healthInflight = null;
      });
  }
  return _healthInflight;
}

/** Check whether a Cape health source key is fresh/available. */
export async function checkCapeSourceFresh(key, options) {
  const health = await getCapeHealth(options).catch(() => null);
  return isCapeSourceFresh(health, key);
}
