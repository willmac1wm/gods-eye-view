import {
  normalizeOutageCounty,
  normalizeOutageAreas,
  normalizeOutageAlerts,
  hasMajorEvent,
} from './records.js';

export { hasMajorEvent };

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createAprsWeatherSource — the proxy owns the upstream calls,
 * the cache and the rate-limit backoff; this client only validates what
 * comes back. MassOutage also allows direct browser fetches (open CORS),
 * but the proxy is the shipped path: one cached server call serves every
 * client inside the keyless 5 req/5 min limit, and a free server key
 * (MASSOUTAGE_API_KEY) removes that limit entirely.
 *
 * Attribution (baked into the layer panel): "MassOutage
 * (massoutage.com), unofficial aggregate, as of <time>".
 */
export function createMassOutageSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/outages', {
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
      if (!response.ok) throw new Error(`Outages HTTP ${response.status}`);
      const county = normalizeOutageCounty(payload?.county);
      const areas = normalizeOutageAreas(payload?.areas);
      const alerts = normalizeOutageAlerts(payload?.alerts);
      if (!county || !areas || !alerts)
        throw new Error('Malformed MassOutage response');
      return {
        fetchedAt: payload?.fetchedAt ?? null,
        stale: payload?.stale === true,
        ttlMs: payload?.ttlMs ?? null,
        county,
        areas,
        alerts,
        majorEvent: hasMajorEvent(alerts),
      };
    },
  };
}
