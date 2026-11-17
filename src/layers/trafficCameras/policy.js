/**
 * Live traffic-camera policy constants.
 *
 * Both upstreams already exist as server providers (PR #19): NJDOT 511
 * (/api/nj511, keyed — inert until NJ511_API_KEY is configured) and
 * DelDOT TMC + ArcGIS fallback + DRBA ferry-webcam seed
 * (/api/deldot-cameras, keyless). This layer only merges them; it adds
 * no new provider and never calls 511nj.org or tmc.deldot.gov directly.
 *
 * NJDOT terms (verified 2026-11-16, NJDOT Website Legal Statement,
 * https://www.nj.gov/transportation/legal/ §E): department information
 * may be viewed, copied or distributed by anyone, "as is". The 511NJ
 * API developer agreement is registration-gated and still unread — if
 * it forbids display when William registers, the NJ511 half stays off
 * and the layer is DelDOT-only.
 */
export const LAYER_ID = 'traffic-cameras';
export const TRAFFIC_CAMERAS_REFRESH_MS = 15 * 60 * 1000;
export const TRAFFIC_CAMERAS_OVERLAY_COHORT_LIMIT = 25;
export const TRAFFIC_CAMERAS_PIN_RADIUS_M = 500;
