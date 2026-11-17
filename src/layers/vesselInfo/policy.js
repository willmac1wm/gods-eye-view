// src/layers/vesselInfo/policy.js
// Vessel background / inspections constants. Both references are
// link-outs only — neither offers a public API, and neither is ever
// scraped. No deep link is shipped for either: Equasis search is
// behind registration, and Maritime Database has no verified search
// URL (its /search?query= path renders the home page). The panel
// links the home pages with the vessel's name/IMO in the link text.
export const VESSEL_INFO_LAYER_ID = 'vessel-info';
export const VESSEL_INFO_OVERLAY_SOURCE_ID = 'vessel-info';
export const VESSEL_INFO_ATTRIBUTION =
  'Background references: Equasis · Maritime Database (reference only)';
export const EQUASIS_HOME_URL =
  'https://www.equasis.org/EquasisWeb/public/HomePage';
export const MARITIME_DATABASE_HOME_URL = 'https://maritime-database.com/';
/** Analyst background rows are capped like the vessels feed. */
export const VESSEL_INFO_ANALYST_LIMIT = 200;
/** Background rows recompute whenever the AIS feed refreshes. */
export const VESSEL_INFO_REFRESH_MS = 60_000;
