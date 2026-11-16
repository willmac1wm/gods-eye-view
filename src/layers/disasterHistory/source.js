import {
  normalizeOpenFemaResponse,
  summarizeStormEventYears,
  validateDisasterSnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createEiaFuelSource — the proxy owns the OpenFEMA call, the
 * 24-hour cache and the static Storm Events snapshot; this client only
 * validates what comes back.
 *
 * Attribution (baked into the layer panel): "Sources: FEMA OpenFEMA;
 * NOAA NCEI Storm Events Database". The two halves stay separate —
 * FEMA declarations and individual storm events are never added together.
 */
export function createDisasterHistorySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/disaster-history', {
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
        throw new Error(`Disaster history HTTP ${response.status}`);
      const fema = normalizeOpenFemaResponse(payload?.fema);
      if (!fema) throw new Error('Malformed OpenFEMA response');
      const years =
        payload?.stormEvents?.years &&
        typeof payload.stormEvents.years === 'object'
          ? payload.stormEvents.years
          : null;
      if (!years) throw new Error('Malformed storm-events snapshot');
      const snapshot = {
        fetchedAt: payload?.fetchedAt ?? null,
        stale: payload?.stale === true,
        ttlMs: payload?.ttlMs ?? null,
        declarations: fema.declarations,
        declarationCount: fema.count,
        stormEvents: {
          source: payload?.stormEvents?.source ?? null,
          sourceFiles: payload?.stormEvents?.sourceFiles ?? {},
          generated: payload?.stormEvents?.generated ?? null,
          years,
          summary: summarizeStormEventYears(years),
        },
      };
      return validateDisasterSnapshot(snapshot);
    },
  };
}
