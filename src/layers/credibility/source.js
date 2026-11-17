import { CREDIBILITY_API_URL } from './policy.js';
import {
  normalizeCredibilitySnapshot,
  validateCredibilitySnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Reads the scored clusters from the sidecar via the Node proxy
 * (/api/credibility, mounted in server/providers/sidecar.js) — the score
 * is computed server-side in sidecar/app/credibility.py, so this client
 * only fetches and validates what comes back. It never scores anything
 * itself: a client-side score would be a second source of truth.
 *
 * Attribution (baked into the layer panel): the credibility score is
 * Cape Dispatch's own rules over its own stored alerts; blocked sources
 * (RT, Sputnik, PressTV) are excluded server-side and counted, never
 * silently dropped.
 */
export function createCredibilitySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(CREDIBILITY_API_URL, {
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
      if (!response.ok) throw new Error(`Credibility HTTP ${response.status}`);
      const snapshot = validateCredibilitySnapshot(
        normalizeCredibilitySnapshot(payload),
      );
      if (!snapshot) throw new Error('Malformed credibility response');
      return snapshot;
    },
  };
}
