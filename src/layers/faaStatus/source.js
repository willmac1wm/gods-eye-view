/** Feed older than this is flagged stalled (the feed regenerates every few minutes). */
export const FAA_NAS_STALE_MS = 15 * 60_000;

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createUsgsGaugesSource — the proxy owns the upstream call,
 * the cache and the backoff; this client only validates what comes back.
 * The NAS feed has no CORS, so the browser cannot fetch it directly:
 * the server proxy is the only path.
 *
 * Attribution (baked into the layer panel): "Source: FAA NAS Status".
 * A quiet feed (no local events) is the normal steady state, not an
 * error — it renders no pins and reports zero local events.
 */
export function createFaaNasSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/faa-status', {
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
      if (!response.ok) throw new Error(`FAA status HTTP ${response.status}`);
      const parsed = normalizePayload(payload);
      if (!parsed) throw new Error('Malformed FAA status response');
      const nowMs = now();
      return {
        ...parsed,
        updateStale:
          Number.isFinite(parsed.updateTimeMs) &&
          nowMs - parsed.updateTimeMs > FAA_NAS_STALE_MS,
      };
    },
  };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.local)) return null;
  if (!payload.nationwide || typeof payload.nationwide !== 'object')
    return null;
  for (const key of [
    'groundStop',
    'groundDelay',
    'closure',
    'arrivalDepartureDelay',
  ]) {
    if (!Number.isFinite(payload.nationwide[key])) return null;
  }
  if (!Number.isFinite(payload.updateTimeMs)) return null;
  if (typeof payload.updateTime !== 'string') return null;
  if (!Number.isFinite(payload.totalAirports)) return null;
  return {
    fetchedAt: payload.fetchedAt ?? null,
    stale: payload.stale === true,
    ttlMs: payload.ttlMs ?? null,
    updateTime: payload.updateTime,
    updateTimeMs: payload.updateTimeMs,
    local: payload.local,
    nationwide: payload.nationwide,
    totalAirports: payload.totalAirports,
  };
}
