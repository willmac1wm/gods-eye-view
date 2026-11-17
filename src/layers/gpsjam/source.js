import { normalizeGpsjamSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createMarineWarningsSource — the proxy owns the upstream
 * calls, the cache and the CSV parsing; this client only validates
 * what comes back. gpsjam.org sends no CORS headers, so a direct
 * browser fetch could not work anyway (verified 2026-11-16).
 */
export function createGpsjamSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/gpsjam', {
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
      if (!response.ok) throw new Error(`GPSJam HTTP ${response.status}`);
      const snapshot = normalizeGpsjamSnapshot(payload);
      if (!snapshot) throw new Error('Malformed GPSJam response');
      return snapshot;
    },
  };
}
