import {
  normalizeWaterLevelPayload,
  normalizePredictionsPayload,
  normalizeFloodLevels,
  normalizeDatums,
  buildGaugeRow,
} from './records.js';

export const TIDES_APPLICATION = 'cape-dispatch';
export const TIDES_DATUM = 'MLLW';
export const TIDES_UNITS = 'english';
export const TIDES_TIME_ZONE = 'lst_ldt';
/** How far back each poll looks: enough points for a trend, nothing more. */
export const TIDES_WINDOW_MINUTES = 30;

/**
 * The two NWLON gauges bracketing Cape May County's oceanfront.
 * Coordinates verified live 2026-11-15 (see PLAN.md §1.1). mllwOffsetFt is
 * the MLLW datum value above station datum (STND) from datums.json, used
 * only to convert the MDAPI flood thresholds (feet above STND) to MLLW.
 */
export const TIDES_GAUGES = Object.freeze([
  Object.freeze({
    id: '8536110',
    name: 'Cape May',
    lat: 38.9683,
    lon: -74.96,
    mllwOffsetFt: 2.42,
  }),
  Object.freeze({
    id: '8534720',
    name: 'Atlantic City',
    lat: 39.3567,
    lon: -74.4181,
    mllwOffsetFt: 4.96,
  }),
]);

/**
 * Flood thresholds in ft MLLW, converted from the MDAPI floodlevels values
 * (feet above station datum) verified 2026-11-15. Fallback when the live
 * floodlevels/datums fetch fails or parses invalid — the thresholds change
 * rarely, and a stale threshold beats no flood stage. NWS set classifies;
 * NOS set is display-only.
 *
 * DISCREPANCY FLAG (2026-11-15): the NWS Mount Holly coastal flood advisory
 * of Nov 13 2026 lists "Cape May Harbor at Cape May" minor at 6.2 ft MLLW,
 * but MDAPI converts to 6.70 ft MLLW for station 8536110. Atlantic City
 * matches exactly (6.00/7.00/8.00), so the station-datum conversion stands;
 * the Cape May gap is most likely a different gauge/reference point or a
 * threshold revision. MDAPI is the layer's source of truth; re-check if NWS
 * publishes a station-specific page for 8536110.
 */
export const FALLBACK_THRESHOLDS_MLLW = Object.freeze({
  8536110: Object.freeze({
    nws: Object.freeze({ minor: 6.7, moderate: 7.7, major: 8.7 }),
    nos: Object.freeze({ minor: 7.3, moderate: 8.24, major: 9.5 }),
  }),
  8534720: Object.freeze({
    nws: Object.freeze({ minor: 6.0, moderate: 7.0, major: 8.0 }),
    nos: Object.freeze({ minor: 6.42, moderate: 7.36, major: 8.62 }),
  }),
});

const DATAGETTER_BASE =
  'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MDAPI_BASE = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations';

function datagetterUrl({ station, product, begin, end, interval }) {
  const query = new URLSearchParams({
    station,
    product,
    datum: TIDES_DATUM,
    units: TIDES_UNITS,
    time_zone: TIDES_TIME_ZONE,
    application: TIDES_APPLICATION,
    format: 'json',
  });
  if (begin && end) {
    query.set('begin_date', begin);
    query.set('end_date', end);
  }
  if (interval) query.set('interval', interval);
  return `${DATAGETTER_BASE}?${query}`;
}

/** "YYYYMMDD HH:MM" in the client's local clock (station-local, lst_ldt). */
function formatCoopsDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function windowFor(now = new Date()) {
  const end = formatCoopsDate(now);
  const begin = formatCoopsDate(
    new Date(now.getTime() - TIDES_WINDOW_MINUTES * 60_000),
  );
  return { begin, end };
}

async function fetchJson(fetchImpl, url, { signal } = {}) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`CO-OPS HTTP ${response.status}`);
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('CO-OPS returned a non-JSON response');
  }
  return payload;
}

/**
 * Direct browser fetch (CO-OPS sends `Access-Control-Allow-Origin: *` on
 * both the datagetter and MDAPI hosts — verified 2026-11-15). Same shape
 * as createUsgsEarthquakeSource: fetchImpl-injectable, AbortSignal-aware.
 * Flood levels + datums are fetched once per source instance and cached;
 * a failure there falls back to FALLBACK_THRESHOLDS_MLLW, never to no data.
 */
export function createCoopsTidesSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  gauges = TIDES_GAUGES,
  now = () => new Date(),
} = {}) {
  let thresholdsCache = null;
  let thresholdsPromise = null;

  async function loadThresholds({ signal } = {}) {
    if (thresholdsCache) return thresholdsCache;
    if (!thresholdsPromise) {
      thresholdsPromise = (async () => {
        const perGauge = {};
        for (const gauge of gauges) {
          try {
            const [floodPayload, datumPayload] = await Promise.all([
              fetchJson(fetchImpl, `${MDAPI_BASE}/${gauge.id}/floodlevels.json`, { signal }),
              fetchJson(fetchImpl, `${MDAPI_BASE}/${gauge.id}/datums.json`, { signal }),
            ]);
            const levels = normalizeFloodLevels(floodPayload);
            const datums = normalizeDatums(datumPayload);
            if (!levels || !datums) throw new Error('malformed flood/datums payload');
            const toMllw = (v) => Math.round((v - datums.mllwOffsetFt) * 100) / 100;
            perGauge[gauge.id] = {
              nws: {
                minor: toMllw(levels.nws.minor),
                moderate: toMllw(levels.nws.moderate),
                major: toMllw(levels.nws.major),
              },
              nos: {
                minor: toMllw(levels.nos.minor),
                moderate: toMllw(levels.nos.moderate),
                major: toMllw(levels.nos.major),
              },
            };
          } catch {
            perGauge[gauge.id] = FALLBACK_THRESHOLDS_MLLW[gauge.id] ?? null;
          }
        }
        return perGauge;
      })().catch(() => {
        // Whole threshold load failed: every gauge falls back.
        const perGauge = {};
        for (const gauge of gauges)
          perGauge[gauge.id] = FALLBACK_THRESHOLDS_MLLW[gauge.id] ?? null;
        return perGauge;
      });
    }
    thresholdsCache = await thresholdsPromise;
    return thresholdsCache;
  }

  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const { begin, end } = windowFor(now());
      const thresholds = await loadThresholds({ signal });
      signal?.throwIfAborted();
      const rows = [];
      for (const gauge of gauges) {
        try {
          const [observedPayload, predictionsPayload] = await Promise.all([
            fetchJson(
              fetchImpl,
              datagetterUrl({
                station: gauge.id,
                product: 'water_level',
                begin,
                end,
              }),
              { signal },
            ),
            fetchJson(
              fetchImpl,
              datagetterUrl({
                station: gauge.id,
                product: 'predictions',
                begin,
                end,
                interval: '6',
              }),
              { signal },
            ),
          ]);
          signal?.throwIfAborted();
          const observed = normalizeWaterLevelPayload(observedPayload);
          const predictions = normalizePredictionsPayload(predictionsPayload);
          if (!observed || !predictions) continue; // malformed gauge: drop it
          const row = buildGaugeRow({
            gauge,
            observed,
            predictions,
            thresholds: thresholds[gauge.id] ?? null,
          });
          if (row) rows.push(row);
        } catch (error) {
          // One gauge down must not sink the other gauge's snapshot.
          if (signal?.aborted) throw error;
          console.warn(`[Data:Tides] gauge ${gauge.id} failed:`, error);
        }
      }
      if (!rows.length) throw new Error('No tide gauge returned usable data');
      return rows;
    },
  };
}
