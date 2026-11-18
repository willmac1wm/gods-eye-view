/**
 * Gas prices for the county ticker and the card its GAS item opens.
 *
 * EIA publishes weekly averages only, and for gasoline the closest one is
 * Central Atlantic (PADD 1B: New Jersey, Pennsylvania, Delaware, Maryland
 * and D.C.) — there is no New Jersey or county gasoline series. Pump prices
 * in Cape May County differ from it, so the GAS item says "Mid-Atlantic
 * avg" and the card links out to pages that list each station's posted
 * price.
 *
 * Those pages are only ever linked, never fetched: GasBuddy's terms forbid
 * scraping, framing or showing its prices on another site, and AAA's forbid
 * redisplaying its county average. The visitor's browser opens them.
 *
 * English-only county content, like the ticker.
 */

/** EIA series the ticker and card read (see src/layers/fuel/records.js). */
export const FUEL_SERIES_IDS = Object.freeze({
  gas: 'EMM_EPMR_PTE_R1Y_DPG',
  diesel: 'EMD_EPD2D_PTE_R1Y_DPG',
  usGas: 'EMM_EPMR_PTE_NUS_DPG',
  usDiesel: 'EMD_EPD2D_PTE_NUS_DPG',
  heatingOilNj: 'W_EPD2F_PRS_SNJ_DPG',
});

/** A weekly figure older than this has missed publications: shown muted. */
export const FUEL_STALE_DAYS = 14;

export const FUEL_LINKS = Object.freeze([
  Object.freeze({
    // i18n-ignore: the gas card is English-only county content.
    label: 'Station prices on GasBuddy ↗',
    href: 'https://www.gasbuddy.com/gasprices/new-jersey/cape-may/1496',
  }),
  Object.freeze({
    // i18n-ignore: the gas card is English-only county content.
    label: 'Gas stations on Google Maps ↗',
    href: 'https://www.google.com/maps/search/?api=1&query=gas%20stations%20Cape%20May%20County%2C%20NJ',
  }),
]);

const PERIOD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const price = (entry) =>
  entry && typeof entry.value === 'number' && Number.isFinite(entry.value)
    ? entry.value
    : null;

/** "$4.06", or null for a missing price so the card leaves the row out. */
export const money = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toFixed(2)}`
    : null;

/** "Nov 16" for an EIA week period "2026-11-16", or null. */
export function weekText(period) {
  if (typeof period !== 'string' || !PERIOD.test(period)) return null;
  const at = new Date(`${period}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Whole days since an EIA week period began, or null. */
export function fuelAgeDays(period, now = Date.now()) {
  if (typeof period !== 'string' || !PERIOD.test(period)) return null;
  const at = Date.parse(`${period}T12:00:00Z`);
  return Number.isFinite(at)
    ? Math.max(0, Math.floor((now - at) / DAY_MS))
    : null;
}

/**
 * The GAS ticker item from an EIA fuel snapshot (createEiaFuelSource), or
 * null when there is no Mid-Atlantic regular price to show.
 */
export function fuelTickerItem(snapshot, now = Date.now()) {
  const gas = snapshot?.latest?.[FUEL_SERIES_IDS.gas];
  const value = price(gas);
  if (value === null) return null;
  const age = fuelAgeDays(gas.period, now);
  const week = weekText(gas.period);
  const stale =
    snapshot.stale === true || age === null || age > FUEL_STALE_DAYS;
  return {
    key: 'fuel',
    layerId: 'fuel-prices',
    // i18n-ignore: the gas card is English-only county content.
    label: 'GAS',
    value: money(value),
    detail: 'Mid-Atlantic avg',
    tone: stale ? 'muted' : 'ok',
    // i18n-ignore: the gas card is English-only county content.
    title: `Regular gasoline, Mid-Atlantic weekly average (U.S. EIA)${week ? `, week of ${week}` : ''}${stale ? ', not current' : ''}. Click for local station prices.`,
  };
}

/**
 * The details-window record the GAS item opens. Works with no snapshot
 * (no key, fetch failed): the station links are still useful then.
 */
export function fuelDetailsRecord(snapshot, now = Date.now()) {
  const latest = snapshot?.latest ?? {};
  const gas = latest[FUEL_SERIES_IDS.gas];
  const diesel = latest[FUEL_SERIES_IDS.diesel];
  const heat = latest[FUEL_SERIES_IDS.heatingOilNj];
  const gasPrice = price(gas);
  const week = weekText(gas?.period);
  const age = fuelAgeDays(gas?.period, now);
  const current =
    gasPrice !== null &&
    snapshot?.stale !== true &&
    age !== null &&
    age <= FUEL_STALE_DAYS;

  const heatPrice = money(price(heat));
  const heatWeek = weekText(heat?.period);
  const heatText = heatPrice
    ? [
        heatPrice,
        heatWeek && heat.period !== gas?.period ? `week of ${heatWeek}` : '',
        snapshot?.heatingOil?.state === 'season-ended' ? 'last season' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const dieselPrice = money(price(diesel));
  const title =
    gasPrice === null
      ? 'Gas prices'
      : [`Gas ${money(gasPrice)}`, dieselPrice ? `Diesel ${dieselPrice}` : '']
          .filter(Boolean)
          .join(' · ');
  const subtitle =
    gasPrice === null
      ? 'Weekly averages are not available right now'
      : `Mid-Atlantic weekly average${week ? ` · week of ${week}` : ''}`;
  const note =
    gasPrice === null
      ? 'The U.S. EIA weekly averages for New Jersey, Pennsylvania, Delaware, Maryland and D.C. are not loading right now. For prices at Cape May County pumps, check a station below.'
      : 'These are U.S. EIA weekly averages for New Jersey, Pennsylvania, Delaware, Maryland and D.C. together; EIA has no county or New Jersey gas price. Prices at Cape May County pumps differ, so check a station below before you go.';

  return {
    kindLabel: 'Gas prices',
    title,
    subtitle,
    status:
      gasPrice === null ? 'unavailable' : current ? 'official' : 'delayed',
    note,
    fields: [
      ['Regular, Mid-Atlantic', money(gasPrice)],
      ['Diesel, Mid-Atlantic', money(price(diesel))],
      ['Regular, U.S. average', money(price(latest[FUEL_SERIES_IDS.usGas]))],
      ['Diesel, U.S. average', money(price(latest[FUEL_SERIES_IDS.usDiesel]))],
      ['Heating oil, New Jersey', heatText],
    ],
    linksLabel: 'Local station prices',
    links: FUEL_LINKS,
    source: 'U.S. Energy Information Administration',
    sourceUrl: 'https://www.eia.gov/petroleum/gasdiesel/',
    fetchedAt: Number.isFinite(snapshot?.fetchedAt) ? snapshot.fetchedAt : null,
  };
}
