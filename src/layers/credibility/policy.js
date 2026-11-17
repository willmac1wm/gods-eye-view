// Credibility + escalation scoring (D2) — policy constants.
//
// The score itself is computed in the sidecar (`sidecar/app/credibility.py`,
// rules over stored news_alerts rows) and served at /api/credibility. This
// module holds only the presentation policy: score bands, the overlay
// cohort limit, the refresh cadence, and the county anchor for the label.
//
// Score bands (pinned; the scorer's point values live in credibility.py
// and are William-set — this file only labels the number):
//   80–100 High — corroborated, official-backed
//   60–79  Medium — single solid source or thin corroboration
//   0–59   Low — unvetted, single-source, or disputed
// A score with no working is a black box: the overlay entry always carries
// the top breakdown lines in `details`, and the panel links the incident.
export const CREDIBILITY_LAYER_ID = 'credibility-scoring';
export const CREDIBILITY_OVERLAY_SOURCE_ID = 'credibility-scoring';
export const CREDIBILITY_ATTRIBUTION =
  'Cape Dispatch credibility scoring — rules over stored alerts; blocked sources (RT, Sputnik, PressTV) excluded';
export const CREDIBILITY_API_URL = '/api/credibility';
/** The credibility list refreshes every 5 minutes (the alert cycle). */
export const CREDIBILITY_REFRESH_MS = 5 * 60_000;
/** One label per scored cluster, at most five on the map. */
export const CREDIBILITY_OVERLAY_COHORT_LIMIT = 5;
/** County anchor for the summary label (Cape May Court House). */
export const CREDIBILITY_COUNTY_CENTER = Object.freeze({
  lat: 39.0798,
  lon: -74.7625,
});
// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** Score bands, in order. */
export const CREDIBILITY_BANDS = Object.freeze([
  Object.freeze({ min: 80, label: msg('High') }),
  Object.freeze({ min: 60, label: msg('Medium') }),
  Object.freeze({ min: 0, label: msg('Low') }),
]);
/** Trend labels, in escalation order. */
export const CREDIBILITY_TRENDS = Object.freeze([
  'Stabilizing',
  'Elevated',
  'Escalating',
]);
