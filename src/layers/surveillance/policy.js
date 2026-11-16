/**
 * Community-mapped OpenStreetMap surveillance-camera locations, via the
 * app's Overpass proxy. OSM data remains ODbL, separate from the
 * application code. These are mapped locations, not footage, plate
 * records or evidence of current activity.
 */

export const LAYER_ID = 'surveillance-cameras';

export const OVERPASS_URL = '/api/overpass';

/** Keep camera acquisition city-scale, never globe-wide. */
export const MAX_VIEWPORT_DEGREES = 3;

/** Camera record cap; reaching it reports limited coverage. */
export const QUERY_LIMIT = 1500;

/**
 * A view still fully inside the last fetched coverage reuses those records
 * for this long before querying Overpass again. This data barely changes;
 * there is no polling loop.
 */
export const QUERY_REUSE_MS = 24 * 60 * 60 * 1000;

/** Meters — illustrative facing wedge depth, when a camera reports a bearing. */
export const DIRECTION_CONE_M = 90;
export const DIRECTION_CONE_HALF_ANGLE_DEG = 20;

/** Vendor-neutral camera badge palette, with coral selection. */
export const SURVEILLANCE_COLOR = '#c792ea';
export const SURVEILLANCE_SELECTED_COLOR = '#ff6474';
export const MARKER_ICON_SIZE = 38;
