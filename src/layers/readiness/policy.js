// Readiness tools (D6) — policy constants.
//
// The checklists themselves are static, curated from Ready.gov
// (`src/layers/readiness/checklists.json`, FEMA public domain, verified
// live 2026-11-17). This module holds only the presentation policy: the
// live-state driver mapping (which layer state drives which item), the
// driver thresholds, the go-bag quantity rules, and the county anchor.
//
// The "due now" strip is live; the checklists never disappear — a driver
// layer that is missing or stale falls its items back to the baseline
// ("live status unavailable"), never to "due now" and never to hidden.
export const READINESS_LAYER_ID = 'readiness';
export const READINESS_OVERLAY_SOURCE_ID = 'readiness';
export const READINESS_ATTRIBUTION =
  'Cape Dispatch readiness — checklists curated from Ready.gov / FEMA (public domain); urgency driven by live layer states';
/** The drivers recompute on the layer's refresh cadence. */
export const READINESS_REFRESH_MS = 5 * 60_000;
/** County anchor for the summary label (Cape May Court House). */
export const READINESS_COUNTY_CENTER = Object.freeze({
  lat: 39.0798,
  lon: -74.7625,
});
/** localStorage key for the done-state (local-only; the server never sees it). */
export const READINESS_DONE_KEY = 'cape-dispatch:readiness:done:v1';
/** Default household size for the go-bag builder. */
export const READINESS_DEFAULT_HOUSEHOLD_SIZE = 4;
/** Household-size chips offered in the row controls. */
export const READINESS_HOUSEHOLD_SIZES = Object.freeze([1, 2, 3, 4, 5, 6]);
/** Go-bag rule (Ready.gov: 1 gallon per person per day, 3 days). */
export const READINESS_WATER_GALLONS_PER_PERSON_PER_DAY = 1;
export const READINESS_GO_BAG_DAYS = 3;
// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/**
 * Driver thresholds (pinned; William-set like the D4 rule table — this
 * file only labels the numbers, the readers in records.js apply them):
 * flood — a Coastal Flood / Flood / Flash Flood alert, or the tide at or
 * above the NWS minor-flood line (6.2 ft MLLW at Cape May 8536110);
 * power — 1,000+ customers out in the county (the D4 Power rule);
 * drought — U.S. Drought Monitor category D2 (Severe) or worse;
 * space — Kp 5+ (G1) or a G-scale reading.
 */
export const READINESS_TIDE_MINOR_FT = 6.2;
export const READINESS_OUTAGES_CUSTOMERS = 1000;
export const READINESS_DROUGHT_CATEGORY = 2;
export const READINESS_KP = 5;

/** The six drivers, in the order the summary lists them. */
export const READINESS_DRIVERS = Object.freeze([
  'flood',
  'storm',
  'cold',
  'power',
  'drought',
  'space',
]);

/** Human labels for the drivers. */
export const READINESS_DRIVER_LABELS = Object.freeze({
  flood: msg('Flood'),
  storm: msg('Storm'),
  cold: msg('Cold'),
  power: msg('Power outage'),
  drought: msg('Drought'),
  space: msg('Space weather'),
});
