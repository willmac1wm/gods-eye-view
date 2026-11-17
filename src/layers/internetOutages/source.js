// src/layers/internetOutages/source.js
import { normalizeIodaSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createGdacsSource — the proxy owns the upstream calls, the
 * cache and the windows; this client only validates what comes back.
 * IODA's API sends CORS headers, but the proxy is still the shipped path
 * (one cached server call per cycle, consistent backoff, no per-visitor
 * fan-out).
 */
export function createInternetOutagesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/internet-outages', {
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
        throw new Error(`Internet outages HTTP ${response.status}`);
      const snapshot = normalizeIodaSnapshot(payload);
      if (!snapshot) throw new Error('Malformed internet outages response');
      return snapshot;
    },
  };
}
