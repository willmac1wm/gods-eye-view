import { normalizeUsgsLatestFeatures, gaugeIsStale } from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createAprsWeatherSource — the proxy owns the upstream call,
 * the cache and the backoff; this client only validates what comes back.
 * The USGS v1 API is keyless and sends open CORS, but the proxy is the
 * shipped path: one cached server call per 15-minute cycle.
 *
 * Attribution (baked into the layer panel): "Source: USGS, provisional
 * data". Gage height is feet above gage datum, not NAVD88.
 */
export function createUsgsGaugesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/gauges', {
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
      if (!response.ok) throw new Error(`Gauges HTTP ${response.status}`);
      const normalized = normalizeUsgsLatestFeatures(payload?.features);
      if (!normalized) throw new Error('Malformed USGS response');
      const nowMs = now();
      return {
        fetchedAt: payload?.fetchedAt ?? null,
        stale: payload?.stale === true,
        ttlMs: payload?.ttlMs ?? null,
        gauges: normalized.gauges.map((gauge) => ({
          ...gauge,
          stale: gaugeIsStale(gauge.asOfMs, nowMs),
        })),
      };
    },
  };
}
