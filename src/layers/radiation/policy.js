/**
 * Radiation monitor policy constants.
 *
 * Primary: EPA RadNet CDX REST CSV — the nearest fixed air monitors.
 * There is NO RadNet monitor in Cape May County: the nearest are
 * Philadelphia, PA (~60 mi) and Edison, NJ (~90 mi, the only NJ
 * monitor). The card reports regional background and says so.
 *
 * Monitor coordinates below are city centers (the exact monitor
 * street addresses were not pulled from the RadNet monitor pages in
 * the spec pass — pin them there at build time; distances in the card
 * are computed from these and labeled approximate until then).
 * The old Envirofacts efservice path is dead (301 → 404); do not use it.
 */
export const LAYER_ID = 'radiation';
export const RADIATION_REFRESH_MS = 60 * 60 * 1000;
export const RADNET_CDX_BASE =
  'https://radnet.epa.gov/cdx-radnet-rest/api/rest/csv';
export const RADNET_MONITORS = Object.freeze([
  Object.freeze({
    key: 'philadelphia',
    name: 'Philadelphia',
    state: 'PA',
    path: '2026/fixed/pa/philadelphia',
    lat: 39.9526,
    lon: -75.1652,
  }),
  Object.freeze({
    key: 'edison',
    name: 'Edison',
    state: 'NJ',
    path: '2026/fixed/nj/edison',
    lat: 40.5187,
    lon: -74.4121,
  }),
]);
/** County-seat anchor for distance math. */
export const COUNTY_SEAT = Object.freeze({ lat: 39.0827, lon: -74.82 });
/** Safecast API distance is in METERS (verified 2026-11-16). */
export const SAFECAST_SEARCH_RADIUS_M = 200_000;
export const SAFECAST_URL = 'https://api.safecast.org/measurements.json';
