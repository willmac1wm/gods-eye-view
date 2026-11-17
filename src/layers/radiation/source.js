import {
  normalizeSafecastMeasurement,
  parseRadnetCsv,
  validateRadiationSnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createEiaFuelSource — the proxy owns the ~700 KB RadNet CSV
 * fetches, the last-row extraction and the Safecast query; this client
 * only validates what comes back.
 *
 * Attribution (baked into the layer panel): "EPA RadNet · Safecast
 * (CC0)". There is no RadNet monitor in Cape May County — the card
 * reports regional background from the nearest monitors and says so.
 * A dose rate is never fabricated: if a monitor has no reading, the
 * card shows the other monitor + "unavailable", never 0 nSv/h.
 */
export function createRadiationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/radiation', {
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
      if (!response.ok) throw new Error(`Radiation HTTP ${response.status}`);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Malformed radiation response');
      }
      const snapshot = {
        fetchedAt: payload.fetchedAt ?? null,
        stale: payload.stale === true,
        monitors: Array.isArray(payload.monitors) ? payload.monitors : [],
        safecast: payload.safecast ?? null,
      };
      if (snapshot.safecast) {
        const normalized = normalizeSafecastMeasurement(snapshot.safecast);
        snapshot.safecast = normalized;
      }
      return validateRadiationSnapshot(snapshot);
    },
  };
}

// Re-exported for tests and the provider's CSV parsing.
export { parseRadnetCsv };
