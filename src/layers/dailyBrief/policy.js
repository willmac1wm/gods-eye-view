// Daily brief (D5) — policy constants.
//
// The brief itself is written in the sidecar (`sidecar/app/daily_brief.py`,
// the blog writer pointed at the last 24 h of stored items + alerts) and
// served at /api/news/brief. This module holds only the presentation
// policy: the endpoint, the refresh cadence, the staleness rule, and the
// county anchor for the label.
//
// A brief older than 24 h is stale by the layer's clock, not by the store
// — the store keeps the last brief until a new one replaces it, and the
// label says so with its date rather than presenting it as today's. A
// brief in review shows as in review, never as published. With no
// GEMINI_API_KEY the writer is inert and the panel says so — no brief is
// ever faked or backfilled.
export const DAILY_BRIEF_LAYER_ID = 'daily-brief';
export const DAILY_BRIEF_OVERLAY_SOURCE_ID = 'daily-brief';
export const DAILY_BRIEF_ATTRIBUTION =
  'Cape Dispatch daily brief — blog writer over the last 24 h of stored alerts and news; gated like every post';
export const DAILY_BRIEF_API_URL = '/api/news/brief';
/** The brief changes at most twice a day; 15 minutes is plenty. */
export const DAILY_BRIEF_REFRESH_MS = 15 * 60_000;
/** A brief is stale 24 h after it was written. */
export const DAILY_BRIEF_STALE_MS = 24 * 60 * 60_000;
/** County anchor for the summary label (Cape May Court House). */
export const DAILY_BRIEF_COUNTY_CENTER = Object.freeze({
  lat: 39.0798,
  lon: -74.7625,
});
// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** The brief's three sections, in order. */
export const DAILY_BRIEF_SECTIONS = Object.freeze([
  msg('What happened'),
  msg('Still active'),
  msg('What to watch'),
]);
