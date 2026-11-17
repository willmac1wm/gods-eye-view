// src/layers/gdacs/source.js
import { normalizeGdacsSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createMarineWarningsSource — the proxy owns the feed, the cache
 * and the upstream calls; this client only validates what comes back.
 * GDACS sends no CORS headers for the RSS feed, so a direct browser fetch
 * could not work anyway.
 */
export function createGdacsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/gdacs', {
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
      if (!response.ok) throw new Error(`GDACS HTTP ${response.status}`);
      const snapshot = normalizeGdacsSnapshot(payload);
      if (!snapshot) throw new Error('Malformed GDACS response');
      return snapshot;
    },
  };
}
