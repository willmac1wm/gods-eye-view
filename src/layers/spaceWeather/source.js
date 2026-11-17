import {
  normalizeAceMag,
  normalizeAceSwepam,
  normalizeKpCurrent,
  normalizeKpForecast,
  parseThreeDayForecast,
  validateSpaceWeatherSnapshot,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createEiaFuelSource — the proxy owns the SWPC calls, the
 * caches and the 3-day-text parse; this client only validates what
 * comes back.
 *
 * Attribution (baked into the layer panel): "NOAA Space Weather
 * Prediction Center". The card states the Kp 7 aurora threshold
 * explicitly and never implies Kp 5 means visible aurora in Cape May
 * County.
 */
export function createSpaceWeatherSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/space-weather', {
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
        throw new Error(`Space weather HTTP ${response.status}`);
      const kp = normalizeKpCurrent(payload?.kpMinute);
      if (!kp) throw new Error('Malformed Kp response');
      const snapshot = {
        fetchedAt: payload?.fetchedAt ?? null,
        stale: payload?.stale === true,
        kp,
        forecast: normalizeKpForecast(payload?.kpForecast),
        threeDay: parseThreeDayForecast(payload?.threeDayText),
        solarWind: normalizeAceSwepam(payload?.aceSwepam),
        mag: normalizeAceMag(payload?.aceMag),
      };
      return validateSpaceWeatherSnapshot(snapshot);
    },
  };
}
