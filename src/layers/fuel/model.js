import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
/** County-seat anchor for the price ticker overlay label. */
export const FUEL_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});
export const FUEL_OVERLAY_SOURCE_ID = 'fuel-prices';
export const FUEL_OVERLAY_COHORT_LIMIT = 1;
export const FUEL_ATTRIBUTION =
  'Source: U.S. Energy Information Administration';

function money(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}

function weekLabel(period) {
  if (typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period))
    return null;
  const [year, month, day] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * One price-ticker overlay label over the county seat. PADD 1B (Central
 * Atlantic: NJ, PA, DE, MD, DC) is the regional proxy for NJ gasoline and
 * diesel; the subtitle calls it the Mid-Atlantic average so it is not read
 * as the price at a county pump.
 */
export function createFuelOverlayEntry({ snapshot }) {
  const latest = snapshot?.latest ?? {};
  const gas = latest.EMM_EPMR_PTE_R1Y_DPG;
  const diesel = latest.EMD_EPD2D_PTE_R1Y_DPG;
  const week = weekLabel(snapshot?.latestWeek ?? gas?.period ?? null);
  return {
    id: 'fuel-prices',
    position: Cesium.Cartesian3.fromDegrees(
      FUEL_COUNTY_CENTER.lon,
      FUEL_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title: `⛽ ${msg('Gas')} ${money(gas?.value)} · ${msg('Diesel')} ${money(diesel?.value)}`,
    subtitle: week
      ? `${msg('Mid-Atlantic average')} · ${msg('week of')} ${week}`
      : msg('Mid-Atlantic average'),
    accent: Cesium.Color.SKYBLUE.toCssColorString(),
    priority: 0,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Analyst seam (mirror of mapAnalystRecord). Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const timeMs = (() => {
    if (Number.isFinite(raw?.timeMs)) return raw.timeMs;
    const parsed = Date.parse(`${String(raw?.period ?? '')}T12:00:00Z`);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  return {
    id: text(raw?.seriesId) || `FUEL-${String(index).padStart(4, '0')}`,
    series: text(raw?.seriesId),
    label: text(raw?.label),
    product: text(raw?.product),
    area: text(raw?.area),
    regionalProxy: raw?.proxy === true,
    value: num(raw?.value),
    unit: text(raw?.unit),
    period: text(raw?.period),
    time: text(raw?.period),
    timeMs,
  };
}
