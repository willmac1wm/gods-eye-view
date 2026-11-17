// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

export const SATELLITE_VERIFICATION_LAYER_ID = 'satellite-verification';
export const SATELLITE_VERIFICATION_OVERLAY_SOURCE_ID =
  'satellite-verification';
export const SATELLITE_VERIFICATION_ATTRIBUTION = msg(
  'NASA GIBS · Copernicus Sentinel-2',
);
// On demand only: the user picks a date (default latest available). No
// background poller — MODIS true-color lags ~3–6 h behind acquisition.
export const SATELLITE_VERIFICATION_REFRESH_MS = 0;
export const SATELLITE_OVERLAY_COHORT_LIMIT = 2;

/** County anchor (Cape May Court House) — same point as D2/D6. */
export const SATELLITE_COUNTY_CENTER = { lat: 39.0798, lon: -74.7625 };
/** County box for the drape rectangle — same values as COUNTY_RISK_BBOX. */
export const SATELLITE_COUNTY_BBOX = {
  latMin: 38.9,
  latMax: 39.35,
  lonMin: -75.15,
  lonMax: -74.55,
};
/** County point for the Copernicus OData intersects query. */
export const COPERNICUS_COUNTY_POINT = { lat: 39.0, lon: -74.9 };

/** GIBS true-color sources, in the order the probe tries them. */
export const GIBS_SOURCES = Object.freeze([
  {
    id: 'MODIS_Terra',
    label: msg('MODIS Terra'),
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    maxLevel: 9,
    format: 'jpg',
  },
  {
    id: 'MODIS_Aqua',
    label: msg('MODIS Aqua'),
    gibsLayer: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    maxLevel: 9,
    format: 'jpg',
  },
  {
    id: 'VIIRS_NOAA20',
    label: msg('VIIRS NOAA-20'),
    gibsLayer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    maxLevel: 9,
    format: 'jpg',
  },
]);

/** County tile at zoom 9 for the probe (lat 39.0, lon −74.9). */
export const SATELLITE_COUNTY_TILE = { z: 9, row: 195, col: 149 };
/** How many days back the probe steps before admitting "no imagery". */
export const SATELLITE_MAX_LOOKBACK_DAYS = 7;
/** A tile whose downscaled samples are all below this is GIBS "no data". */
export const SATELLITE_BLACK_TILE_THRESHOLD = 8;
/** Below this size a tile is treated as black when no decoder exists. */
export const SATELLITE_BLACK_TILE_SIZE_BYTES = 2048;

/** Copernicus Data Space Ecosystem OData catalogue (anonymous metadata). */
export const COPERNICUS_ODATA_BASE_URL =
  'https://catalogue.dataspace.copernicus.eu/odata/v1';
export const COPERNICUS_ODATA_COLLECTION = 'SENTINEL-2';
export const COPERNICUS_ODATA_TOP = 10;
/** The Cape May Sentinel-2 tile; neighbouring tiles (e.g. T18SWJ) also
 *  intersect the county point and are listed, not hidden. */
export const COPERNICUS_COUNTY_TILE = 'T18SVJ';
/** Server provider route (the browser never calls the catalogue directly). */
export const SATELLITE_ODATA_ROUTE = '/api/satellite-verification';

/** Date chips offered for the active (A) date, in days back from today. */
export const SATELLITE_DATE_CHIPS = Object.freeze([
  { id: 'latest', label: msg('Latest'), daysBack: 0 },
  { id: 'minus-1d', label: msg('−1 day'), daysBack: 1 },
  { id: 'minus-7d', label: msg('−7 days'), daysBack: 7 },
  { id: 'minus-30d', label: msg('−30 days'), daysBack: 30 },
]);
/** Default compare (B) date: 7 days before the active date. */
export const SATELLITE_COMPARE_DAYS_BACK = 7;
