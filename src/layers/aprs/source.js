import { normalizeAprsWxSnapshot } from './records.js';

/**
 * Typed error for the proxy's 503 {error:'no_key'}: the layer shows a
 * "key not configured" state for this, not a generic failure. The API key
 * lives in server env only (APRSFI_API_KEY) and never reaches the browser —
 * the client only ever talks to same-origin /api/aprs (api.aprs.fi sends
 * no CORS headers, so a direct browser fetch could not work anyway).
 */
export class AprsKeyMissingError extends Error {
  constructor(message = 'aprs.fi key not configured') {
    super(message);
    this.name = 'AprsKeyMissingError';
    this.code = 'no_key';
  }
}

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createFirmsSource — the proxy owns the key, the cache and the
 * upstream call; this client only validates what comes back.
 */
export function createAprsWeatherSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/aprs', {
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
      if (!response.ok) {
        if (response.status === 503 && payload?.error === 'no_key')
          throw new AprsKeyMissingError();
        throw new Error(`APRS HTTP ${response.status}`);
      }
      const rows = normalizeAprsWxSnapshot(payload);
      if (!rows) throw new Error('Malformed aprs.fi response');
      return rows;
    },
  };
}
