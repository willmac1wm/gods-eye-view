import { normalizeVdl2Snapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createGpsjamSource — the proxy owns the upstream calls, the
 * fan-out, the cache and the categorization; this client only validates
 * what comes back. A direct browser fetch of airframes.io does work
 * (CORS reflects any Origin, verified 2026-11-16), but an unfiltered
 * last-hour fetch returns only the newest 100 messages *globally*
 * (~2M/day), so a client would need the watcher's 11-keyword fan-out
 * per cycle against a shared anonymous budget of 60 req/min — the
 * proxy does the fan-out once, server-side, following the FIRMS
 * `/api/firms` pattern.
 */
export function createVdl2Source({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/vdl2', {
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
      if (!response.ok) throw new Error(`VDL2 HTTP ${response.status}`);
      const snapshot = normalizeVdl2Snapshot(payload);
      if (!snapshot) throw new Error('Malformed VDL2 response');
      return snapshot;
    },
  };
}
