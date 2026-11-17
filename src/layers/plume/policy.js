// src/layers/plume/policy.js
// NWS forecast winds (api.weather.gov, U.S. federal public domain) drive
// a SIMPLE WIND PLUME — advection only. NOAA HYSPLIT has NO automation
// API, so this layer is NEVER a HYSPLIT run: the label carries
// "Advection only — not a HYSPLIT run" and "Planning aid only — follow
// official guidance" on every view, and the code never claims HYSPLIT
// except to state it is not used.
//
// Verified live 2026-11-17: the NWS gridpoint hourly endpoint sends
// CORS `Access-Control-Allow-Origin: *`, so the layer fetches direct
// (tides precedent) with no server provider. Release winds come from
// the Salem/Hope Creek grid cell PHI/40,55 (pinned via the NWS /points/
// lookup for 39.4628,-75.5356); the Cape May cell PHI/52,86 is the
// county reference only. Release point: the NRC Salem/Hope Creek site
// coordinates 39°27′46″N, 75°32′08″W (39.46278, -75.53556), Lower
// Alloways Creek Twp, Salem County, NJ — NRC FEMA exercise report
// ML082400494 and NRC Additional Protocol filing ML090270874 agree;
// Hope Creek's own unit sits at 39.46778, -75.53806. EPZ center is the
// site; radius 10 miles (the federal 10-mile plume EPZ standard).
export const PLUME_LAYER_ID = 'fallout-plume';
export const PLUME_OVERLAY_SOURCE_ID = 'fallout-plume';
export const PLUME_ATTRIBUTION =
  'National Weather Service (api.weather.gov) · Simple wind plume — advection only, not a HYSPLIT run';
export const PLUME_NWS_HOURLY_URL =
  'https://api.weather.gov/gridpoints/PHI/40,55/forecast/hourly?units=us';
export const PLUME_NWS_POINTS_URL =
  'https://api.weather.gov/points/39.4628,-75.5356';
/** Default release point: the NRC Salem/Hope Creek site coordinates. */
export const PLUME_DEFAULT_RELEASE = Object.freeze({
  name: 'Salem/Hope Creek',
  lat: 39.46278,
  lon: -75.53556,
});
/** The 10-mile plume Emergency Planning Zone, centered on the site. */
export const PLUME_EPZ_RADIUS_MI = 10;
/** NWS grid cell for the release point (PHI office, grid 40,55). */
export const PLUME_GRIDPOINT = 'PHI/40,55';
/** Plume horizon: 24 h max (the NWS hourly forecast spans 7 days). */
export const PLUME_HORIZON_HOURS = 24;
/** Cone half-angle each side of the centroid path (a fixed, documented spread — not a turbulence model). */
export const PLUME_CONE_HALF_ANGLE_DEG = 15;
/** Calm-hour pooling: each calm hour widens the cone 1 mile in place. */
export const PLUME_CALM_POOL_MI_PER_HOUR = 1;
/** The layer refreshes hourly (the NWS hourly forecast updates hourly). */
export const PLUME_REFRESH_MS = 60 * 60_000;
/** One release-point anchor label, following the fuel layer. */
export const PLUME_OVERLAY_COHORT_LIMIT = 1;
/** Earth radius for the destination-point / haversine math (miles). */
export const PLUME_EARTH_RADIUS_MI = 3958.8;
/** Points on the EPZ reference circle. */
export const PLUME_EPZ_CIRCLE_POINTS = 64;
