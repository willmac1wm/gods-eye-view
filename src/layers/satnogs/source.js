import { normalizeSatnogsSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createMarineWarningsSource — the proxy owns the upstream calls,
 * the cache and the satellite-name resolution; this client only
 * validates what comes back. Neither SatNOGS API sends CORS headers, so
 * a direct browser fetch could not work anyway (verified 2026-11-16).
 */
export function createSatnogsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/satnogs', {
        signal,
        cache: 'no-store',
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (!response.ok) throw new Error(`SatNOGS HTTP ${response.status}`);
      const snapshot = normalizeSatnogsSnapshot(payload);
      if (!snapshot) throw new Error('Malformed SatNOGS response');
      return snapshot;
    },
  };
}
