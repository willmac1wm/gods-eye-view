import { msg } from '../../i18n/marker.js';
/**
 * Validate EIA API v2 weekly price payloads before they can replace the
 * displayed fuel snapshot. Whole-payload rejection (return null) mirrors
 * normalizeEarthquakeSnapshot: a malformed payload never partially
 * overwrites good data. A price is never fabricated: without a key the
 * layer shows the last cached weekly values with their week date, or
 * hides the card.
 *
 * Routes (verified live 2026-11-16 against the EIA API with a discovery
 * key — the shipped provider reads EIA_API_KEY from server env only):
 *   petroleum/pri/gnd — Weekly Retail Gasoline and Diesel Prices
 *   petroleum/pri/wfr — Weekly Heating Oil and Propane Prices
 *
 * No New Jersey gasoline series exists: EIA publishes weekly retail
 * gasoline for the U.S., 5 PADDs, 3 PADD-1 sub-districts, and only 9
 * states (CA, CO, FL, MA, MN, NY, OH, TX, WA). New Jersey is covered by
 * Central Atlantic (PADD 1B: DE, DC, MD, NJ, PA) — displayed labeled as
 * the regional figure, never as "NJ price". Heating oil DOES have a real
 * NJ series (W_EPD2F_PRS_SNJ_DPG).
 */

/** Series the layer tracks. `proxy` marks the PADD 1B regional stand-in. */
export const FUEL_SERIES = Object.freeze([
  Object.freeze({
    id: 'EMM_EPMR_PTE_NUS_DPG',
    product: 'gasoline',
    area: 'U.S.',
    label: msg('Regular gasoline — U.S.'),
    proxy: false,
  }),
  Object.freeze({
    id: 'EMM_EPMR_PTE_R1Y_DPG',
    product: 'gasoline',
    area: 'Central Atlantic (PADD 1B)',
    label: msg('Regular gasoline — Central Atlantic (PADD 1B)'),
    proxy: true,
  }),
  Object.freeze({
    id: 'EMD_EPD2D_PTE_NUS_DPG',
    product: 'diesel',
    area: 'U.S.',
    label: msg('On-highway diesel — U.S.'),
    proxy: false,
  }),
  Object.freeze({
    id: 'EMD_EPD2D_PTE_R1Y_DPG',
    product: 'diesel',
    area: 'Central Atlantic (PADD 1B)',
    label: msg('On-highway diesel — Central Atlantic (PADD 1B)'),
    proxy: true,
  }),
  Object.freeze({
    id: 'W_EPD2F_PRS_NUS_DPG',
    product: 'heating-oil',
    area: 'U.S.',
    label: msg('Residential heating oil — U.S.'),
    proxy: false,
  }),
  Object.freeze({
    id: 'W_EPD2F_PRS_R1Y_DPG',
    product: 'heating-oil',
    area: 'Central Atlantic (PADD 1B)',
    label: msg('Residential heating oil — Central Atlantic (PADD 1B)'),
    proxy: true,
  }),
  Object.freeze({
    id: 'W_EPD2F_PRS_SNJ_DPG',
    product: 'heating-oil',
    area: 'New Jersey',
    label: msg('Residential heating oil — New Jersey'),
    proxy: false,
  }),
]);

export const FUEL_SERIES_BY_ID = Object.freeze(
  Object.fromEntries(FUEL_SERIES.map((series) => [series.id, series])),
);

const PERIOD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60_000;

/**
 * EIA v2 data payload:
 * {"response":{"total":"...","dateFormat":"YYYY-MM-DD","frequency":"weekly",
 *   "data":[{"period":"2026-11-09","series":"EMM_EPMR_PTE_R1Y_DPG",
 *   "series-description":"...","value":4.146,"units":"$/GAL"}]}}
 * Returns {seriesId: {seriesId, label, product, area, proxy, unit,
 * values: [{period, value}] newest first}} for the tracked series with at
 * least one valid row, or null when malformed / empty. Rows for untracked
 * series are ignored; rows with a bad period or non-finite value are
 * skipped, never zero-filled.
 */
export function normalizeEiaSeriesResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const response = payload.response;
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return null;
  if (!Array.isArray(response.data)) return null;
  const grouped = new Map();
  for (const row of response.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const meta = FUEL_SERIES_BY_ID[row.series];
    if (!meta) continue; // untracked series: ignore, don't fail the payload
    if (typeof row.period !== 'string' || !PERIOD_PATTERN.test(row.period))
      continue;
    // EIA API v2 sends values as decimal strings ("4.064"); accept those and
    // numbers, and nothing else — a blank or non-numeric value is skipped.
    const value =
      typeof row.value === 'number'
        ? row.value
        : typeof row.value === 'string' && row.value.trim() !== ''
          ? Number(row.value)
          : NaN;
    if (!Number.isFinite(value)) continue;
    if (!grouped.has(meta.id)) {
      grouped.set(meta.id, {
        seriesId: meta.id,
        label: meta.label,
        product: meta.product,
        area: meta.area,
        proxy: meta.proxy,
        unit: typeof row.units === 'string' ? row.units : '$/GAL',
        values: [],
      });
    }
    grouped.get(meta.id).values.push({ period: row.period, value });
  }
  if (grouped.size === 0) return null;
  const result = {};
  for (const [id, series] of grouped) {
    series.values.sort((a, b) => (a.period < b.period ? 1 : -1));
    result[id] = series;
  }
  return result;
}

/** Newest {period, value} per series, or null for a series with no rows. */
export function latestPerSeries(seriesMap) {
  if (!seriesMap || typeof seriesMap !== 'object') return {};
  const latest = {};
  for (const [id, series] of Object.entries(seriesMap)) {
    const first = Array.isArray(series?.values) ? series.values[0] : null;
    latest[id] = first ? { period: first.period, value: first.value } : null;
  }
  return latest;
}

function periodMsOrNull(period) {
  if (typeof period !== 'string' || !PERIOD_PATTERN.test(period)) return null;
  const ms = Date.parse(`${period}T12:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Heating-oil freshness. EIA collects heating oil October–March only and
 * publishes Wednesdays after 1:00 PM ET; outside the season the series
 * goes stale. A latest period ≤14 days old is current; 15–60 days is a
 * publication gap (stale); >60 days means the season ended — show the
 * last price with its week date, never as current.
 */
export function heatingOilStatus(latestPeriod, nowMs = Date.now()) {
  const periodMs = periodMsOrNull(latestPeriod);
  if (periodMs == null) return { state: 'unknown', ageDays: null };
  const ageDays = Math.max(0, Math.floor((nowMs - periodMs) / DAY_MS));
  if (ageDays <= 14) return { state: 'current', ageDays };
  if (ageDays <= 60) return { state: 'stale', ageDays };
  return { state: 'season-ended', ageDays };
}
