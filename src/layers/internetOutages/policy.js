// src/layers/internetOutages/policy.js
// IODA (Internet Outage Detection and Analysis, Georgia Tech) constants.
// IODA is free and keyless; responses carry "Copyright (c) 2021-2025
// Georgia Tech Research Corporation" — credit "IODA, Georgia Tech".
// The US and New Jersey scopes are usually quiet (verified 2026-11-17:
// US summary 6 h and 7 d, NJ summary 6 h and 7 d, US alerts 24 h all
// returned data:[]), while global alerts carry the live signal — so the
// layer pairs scoped summaries (US + NJ) with global recent alerts and
// says so on the panel. An empty result is a real result, never an error.
export const INTERNET_OUTAGES_LAYER_ID = 'internet-outages';
export const INTERNET_OUTAGES_OVERLAY_SOURCE_ID = 'internet-outages';
export const INTERNET_OUTAGES_ATTRIBUTION =
  'IODA — Internet Outage Detection and Analysis, Georgia Tech';
export const IODA_API_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
/** New Jersey region code, resolved live via /v2/entities/query 2026-11-17. */
export const IODA_NJ_REGION_CODE = '4453';
export const IODA_US_COUNTRY_CODE = 'US';
/** The provider polls every 5 minutes; the layer refreshes on the same cycle. */
export const INTERNET_OUTAGES_REFRESH_MS = 5 * 60_000;
/** Summary window (US + NJ scopes). */
export const IODA_SUMMARY_WINDOW_SECONDS = 6 * 3600;
/** Alerts window (global scope). */
export const IODA_ALERTS_WINDOW_SECONDS = 24 * 3600;
/** Per-call row caps. */
export const IODA_SUMMARY_LIMIT = 25;
export const IODA_ALERTS_LIMIT = 20;
/** One county-seat anchor label, following the fuel layer. */
export const INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT = 1;
/** IODA alert levels are literal source values; critical outranks the rest. */
export const IODA_ALERT_LEVEL_RANK = Object.freeze({
  critical: 2,
  normal: 1,
});
export const IODA_SOURCE_UNITS = Object.freeze({
  bgp: 'Visible /24s',
  'ping-slash24': 'Up /24s',
  'merit-nt': 'Unique Source IPs',
  gtr: 'Traffic',
});
