// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

export const ALPR_AVOIDANCE_LAYER_ID = 'alpr-avoidance-routing';
export const ALPR_AVOIDANCE_OVERLAY_SOURCE_ID = 'alpr-avoidance-routing';
export const ALPR_AVOIDANCE_ATTRIBUTION = msg(
  'OpenStreetMap routing · ALPR locations (OpenStreetMap)',
);
// Refresh every 15 s only to notice a changed A/B in the Directions layer;
// the source fetches only when the endpoints actually changed, so the tick
// is a stats read and a comparison, not a route request.
export const ALPR_AVOIDANCE_REFRESH_MS = 15_000;
export const ALPR_AVOIDANCE_OVERLAY_COHORT_LIMIT = 2;
/** v1 ships car only; the proxy already supports foot and bike. */
export const ALPR_AVOIDANCE_PROFILE = 'car';
export const ALPR_AVOIDANCE_MAX_ALTERNATIVES = 3;
export const ALPR_AVOIDANCE_ROUTE = '/api/route';
/** A camera counts against a route when it is within this distance of the
 * polyline — the same 90 m the ALPR layer uses for its direction cone. */
export { DIRECTION_CONE_M as ALPR_AVOIDANCE_EXPOSURE_RADIUS_M } from '../alpr/policy.js';
export const ALPR_AVOIDANCE_FASTEST_COLOR = '#7aa5ff';
export const ALPR_AVOIDANCE_LOWEST_COLOR = '#9fd6a4';
