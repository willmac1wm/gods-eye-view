/**
 * Drought status policy constants.
 *
 * Source: U.S. Drought Monitor, weekly (Thursdays). The working URL is
 * https://droughtmonitor.unl.edu/data/json/usdm_current.json — the
 * /data/geojson/usdm_current.geojson path 404s (verified 2026-11-16).
 * The file is one GeoJSON FeatureCollection with one feature per DM
 * category (0–4, national polygons). The proxy does point-in-polygon
 * server-side; the browser never downloads the national polygons.
 */
export const LAYER_ID = 'drought';
export const DROUGHT_REFRESH_MS = 24 * 60 * 60 * 1000;
export const DROUGHT_URL =
  'https://droughtmonitor.unl.edu/data/json/usdm_current.json';
/** Sample points across the county bbox; the card shows the worst category found. */
export const COUNTY_SAMPLE_POINTS = Object.freeze([
  Object.freeze({ lat: 39.08, lon: -74.9 }), // county seat
  Object.freeze({ lat: 39.3, lon: -75.05 }),
  Object.freeze({ lat: 39.3, lon: -74.6 }),
  Object.freeze({ lat: 38.95, lon: -74.6 }),
  Object.freeze({ lat: 38.95, lon: -75.05 }),
  Object.freeze({ lat: 39.15, lon: -74.82 }),
  Object.freeze({ lat: 39.05, lon: -74.75 }),
]);
