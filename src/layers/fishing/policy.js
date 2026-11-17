// src/layers/fishing/policy.js
// Fishing-vessel presence constants. The AIS half shows presence only —
// "fishing vessels present", never "fishing activity" or "fishing
// effort": those words belong to Global Fishing Watch's model, and a
// fishing vessel underway is not necessarily fishing. The GFW half is
// a link-out in v1 (its v3 API is key-gated); v2 wires /v3/4wings/report
// behind a free token William requests on return.
export const FISHING_LAYER_ID = 'fishing-activity';
export const FISHING_OVERLAY_SOURCE_ID = 'fishing-activity';
export const FISHING_ATTRIBUTION =
  'Fishing-vessel presence: own AIS · Apparent fishing effort: Global Fishing Watch (CC BY-NC 4.0)';
export const GFW_MAP_HOME_URL = 'https://globalfishingwatch.org/map/';
export const GFW_APIS_URL = 'https://globalfishingwatch.org/our-apis/';
/** AIS ship type 30 = Fishing (31/32 towing are excluded). */
export const FISHING_SHIP_TYPE = '30';
/** County / Delaware Bay box for the presence count. */
export const FISHING_BOX = Object.freeze({
  minLat: 38.9,
  maxLat: 39.35,
  minLon: -75.15,
  maxLon: -74.55,
});
/** Delaware Bay center + zoom for the GFW map deep link. */
export const GFW_MAP_CENTER = Object.freeze({ lat: 39.12, lon: -74.85 });
export const GFW_MAP_ZOOM = 9;
export function gfwMapUrl() {
  return (
    'https://globalfishingwatch.org/map/fishing-activity/default-public/' +
    `?latitude=${GFW_MAP_CENTER.lat}&longitude=${GFW_MAP_CENTER.lon}` +
    `&zoom=${GFW_MAP_ZOOM}`
  );
}
/** Presence recomputes whenever the AIS feed refreshes. */
export const FISHING_REFRESH_MS = 60_000;
