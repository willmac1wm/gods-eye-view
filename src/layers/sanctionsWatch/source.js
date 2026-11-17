// src/layers/sanctionsWatch/source.js
// Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
// Mirrors createRadiationSource — the proxy owns the ArcNautical call,
// the 1-hour per-IMO cache and the 429/503 handling; this client only
// validates what comes back. The browser never calls ArcNautical
// directly. Attribution is baked into the layer panel:
// "Screening: ArcNautical · AIS dark-vessel signals".
import { isValidImo, normalizeImo, validateScreening } from './records.js';
import { SANCTIONS_PROXY_PATH } from './policy.js';

export function createSanctionsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async screenVessel(imo, { signal } = {}) {
      const normalized = normalizeImo(imo);
      if (!normalized || !isValidImo(normalized)) {
        throw new TypeError(`Invalid IMO number: ${String(imo ?? '')}`);
      }
      signal?.throwIfAborted();
      const response = await fetchImpl(
        `${SANCTIONS_PROXY_PATH}?imo=${encodeURIComponent(normalized)}`,
        { signal, cache: 'no-store' },
      );
      let payload;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`Sanctions check HTTP ${response.status}`);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Malformed sanctions response');
      }
      return validateScreening(payload);
    },
  };
}
