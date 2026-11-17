import { normalizeMarineWarningsSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createAprsWeatherSource — the proxy owns the feeds, the cache
 * and the upstream calls; this client only validates what comes back.
 * GovDelivery sends no CORS headers, so a direct browser fetch could not
 * work anyway (verified 2026-11-16).
 */
export function createMarineWarningsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/marine-warnings', {
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
      if (!response.ok)
        throw new Error(`Marine warnings HTTP ${response.status}`);
      const snapshot = normalizeMarineWarningsSnapshot(payload);
      if (!snapshot) throw new Error('Malformed marine warnings response');
      return snapshot;
    },
  };
}
