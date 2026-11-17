import { countyDrought, validateDroughtSnapshot } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createEiaFuelSource — the proxy owns the USDM fetch, the
 * 24-hour cache and the point-in-polygon computation; this client only
 * validates what comes back.
 *
 * Attribution (baked into the layer panel): "U.S. Drought Monitor
 * (droughtmonitor.unl.edu)". The map is released weekly on Thursdays;
 * the card always shows the release date.
 */
export function createDroughtSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/drought', {
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
      if (!response.ok) throw new Error(`Drought HTTP ${response.status}`);
      if (
        !payload ||
        typeof payload !== 'object' ||
        !Array.isArray(payload.categories) ||
        !('category' in payload)
      )
        throw new Error('Malformed drought response');
      return validateDroughtSnapshot({
        fetchedAt: payload.fetchedAt ?? null,
        releasedAt: payload.releasedAt ?? null,
        stale: payload.stale === true,
        category: payload.category,
        categories: payload.categories,
      });
    },
  };
}

// Re-exported for tests and the provider's county-max rule.
export { countyDrought };
