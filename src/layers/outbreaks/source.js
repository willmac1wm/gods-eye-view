// src/layers/outbreaks/source.js
import { normalizeOutbreaksSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createInternetOutagesSource — the proxy owns the upstream
 * calls, the cache and the daily window; this client only validates
 * what comes back. CDC and WHO both serve the browser, but the proxy
 * is still the shipped path (one cached server call per day, consistent
 * backoff, no per-visitor fan-out, and the CDC page fetch for the
 * as-of date stays server-side).
 */
export function createOutbreaksSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/outbreaks', {
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
      if (!response.ok) throw new Error(`Outbreaks HTTP ${response.status}`);
      const snapshot = normalizeOutbreaksSnapshot(payload);
      if (!snapshot) throw new Error('Malformed outbreaks response');
      return snapshot;
    },
  };
}
