// src/layers/plume/source.js
import { PLUME_NWS_HOURLY_URL } from './policy.js';
import {
  buildPlumeSnapshot,
  parseNwsHourlyForecast,
  validatePlumeSnapshot,
} from './records.js';

/**
 * Direct NWS fetch client: fetchImpl-injectable, AbortSignal-aware.
 * api.weather.gov sends CORS `Access-Control-Allow-Origin: *` (verified
 * 2026-11-17), so the layer fetches the release-point hourly forecast
 * straight from the browser — the tides CO-OPS precedent — with no
 * server provider. The existing nws-wind provider serves current
 * observations at ASOS stations, not the 24-hour forecast the plume
 * steps on, so it does not cover this layer. The client only fetches
 * and validates; the plume math lives in records.js.
 */
export function createFalloutPlumeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  url = PLUME_NWS_HOURLY_URL,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, {
        signal,
        headers: {
          Accept: 'application/geo+json',
          'User-Agent': 'gods-eye-view/1.0 (+https://capemaydispatch.com)',
        },
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        /* status below remains authoritative */
      }
      signal?.throwIfAborted();
      if (!response.ok)
        throw new Error(`Fallout plume HTTP ${response.status}`);
      const winds = parseNwsHourlyForecast(payload);
      if (!winds || winds.length === 0)
        throw new Error('Malformed fallout plume response');
      const snapshot = validatePlumeSnapshot(
        buildPlumeSnapshot({ fetchedAt: Date.now(), winds }),
      );
      if (!snapshot) throw new Error('Malformed fallout plume response');
      return snapshot;
    },
  };
}
