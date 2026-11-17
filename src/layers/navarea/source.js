// src/layers/navarea/source.js
// Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
// Mirrors createRadiationSource — the proxy owns the daily NGA
// bulletin fetch and the plain-text parse; this client only validates
// what comes back. The browser never calls NGA directly. Attribution
// is baked into the layer panel, with NGA's SOLAS note:
// "Never navigate from this map — check the official bulletin."
import { validateNavareaSnapshot } from './records.js';

export function createNavareaSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/navarea', {
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
        throw new Error(`NAVAREA warnings HTTP ${response.status}`);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Malformed NAVAREA response');
      }
      const snapshot = validateNavareaSnapshot(payload);
      if (!snapshot) throw new Error('Malformed NAVAREA response');
      return snapshot;
    },
  };
}
