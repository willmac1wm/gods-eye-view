// src/layers/sanctionsWatch/policy.js
// Sanctions / dark-vessel watch constants. ArcNautical keyless check is an
// on-demand, per-vessel lookup (100 req/hr/IP, "a sample for evaluation
// and occasional lookups, not a data feed") — never a bulk sweep.
export const SANCTIONS_WATCH_LAYER_ID = 'sanctions-watch';
export const SANCTIONS_OVERLAY_SOURCE_ID = 'sanctions-watch';
export const SANCTIONS_PROXY_PATH = '/api/sanctions/check';
export const SANCTIONS_ATTRIBUTION =
  'Screening: ArcNautical · AIS dark-vessel signals';
export const SANCTIONS_DOCS_URL = 'https://arcnautical.com/developers/';
export const SANCTIONS_KEY_URL =
  'https://arcnautical.com/get-a-key?from=keyless';
export const SANCTIONS_LISTS = Object.freeze([
  'OFAC SDN',
  'OpenSanctions',
  'EU FSD',
  'UN Consolidated',
  'UK OFSI',
]);
export function arcnauticalCheckUrl(imo) {
  return `https://arcnautical.com/api/v1/vessels/${imo}/check`;
}
export function arcnauticalReportUrl(imo) {
  return `https://arcnautical.com/check?imo=${imo}`;
}
/** AIS silence vs coverage: no position for >6 h while others report. */
export const SILENCE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
/** Coverage is alive when this many other vessels reported recently. */
export const COVERAGE_MIN_VESSELS = 3;
export const COVERAGE_WINDOW_MS = 15 * 60 * 1000;
/** Implied speed between two consecutive fixes above this is spoofed. */
export const IMPLIED_SPEED_THRESHOLD_KN = 50;
/** A single reported speed above this is implausible for most hulls. */
export const REPORTED_SPEED_THRESHOLD_KN = 30;
/** At most this many fresh screenings per layer update (slow pass). */
export const MAX_SCREENS_PER_UPDATE = 5;
/** A screening answers from cache for one hour, per the ArcNautical docs. */
export const SCREEN_CACHE_TTL_MS = 60 * 60 * 1000;
/** Last-seen identities are kept this long before pruning. */
export const SEEN_RETENTION_MS = 72 * 60 * 60 * 1000;
export const SANCTIONS_PROXY_TTL_MS = SCREEN_CACHE_TTL_MS;
export const SANCTIONS_PROXY_TIMEOUT_MS = 20_000;
/** Dark-vessel signals recompute whenever the AIS feed refreshes. */
export const SANCTIONS_REFRESH_MS = 60_000;
export const SANCTIONS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
