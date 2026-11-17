import {
  normalizeNwsAlertSnapshot,
  validateNwsAlertSnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Reuses the existing /api/nws proxy exactly as-is (zones NJZ023 +
 * NJZ024, 60 s cache) — no new server provider, no new upstream call.
 * The card only re-presents what the provider already returns.
 *
 * Attribution (baked into the layer panel): "National Weather Service /
 * NWS Mount Holly". The card always shows the NWS headline + a link to
 * the alert so any reader can check the raw text.
 */
export function createNwsAlertCardSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/nws', {
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
      if (!response.ok) throw new Error(`NWS alerts HTTP ${response.status}`);
      const parsed = normalizeNwsAlertSnapshot(payload);
      if (!parsed) throw new Error('Malformed NWS alerts response');
      return validateNwsAlertSnapshot({
        fetchedAt: payload?.updatedAt ?? null,
        stale: payload?.stale === true,
        alerts: parsed.alerts,
      });
    },
  };
}
