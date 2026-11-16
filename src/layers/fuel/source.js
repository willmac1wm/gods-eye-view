import {
  normalizeEiaSeriesResponse,
  latestPerSeries,
  heatingOilStatus,
} from './records.js';

/**
 * Typed error for the proxy's 503 {error:'no_key'}: the layer shows a
 * "key not configured" state for this, not a generic failure. The API key
 * lives in server env only (EIA_API_KEY) and never reaches the browser —
 * the client only ever talks to same-origin /api/fuel.
 */
export class EiaKeyMissingError extends Error {
  constructor(message = 'EIA API key not configured') {
    super(message);
    this.name = 'EiaKeyMissingError';
    this.code = 'no_key';
  }
}

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors createAprsWeatherSource — the proxy owns the key, the cache and
 * the upstream calls; this client only validates what comes back.
 *
 * Attribution (baked into the layer panel): "Source: U.S. Energy
 * Information Administration, week of <date>". PADD 1B figures are the
 * labeled regional proxy for New Jersey gasoline/diesel — never "NJ price".
 */
export function createEiaFuelSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/fuel', {
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
          throw new EiaKeyMissingError();
        throw new Error(`Fuel HTTP ${response.status}`);
      }
      const gnd = normalizeEiaSeriesResponse(payload?.gnd);
      const wfr = normalizeEiaSeriesResponse(payload?.wfr);
      if (!gnd || !wfr) throw new Error('Malformed EIA response');
      const series = { ...gnd, ...wfr };
      const latest = latestPerSeries(series);
      const heatNj = latest.W_EPD2F_PRS_SNJ_DPG;
      return {
        fetchedAt: payload?.fetchedAt ?? null,
        stale: payload?.stale === true,
        ttlMs: payload?.ttlMs ?? null,
        latestWeek: payload?.latestWeek ?? null,
        series,
        latest,
        heatingOil: heatingOilStatus(heatNj?.period ?? null, now()),
      };
    },
  };
}
