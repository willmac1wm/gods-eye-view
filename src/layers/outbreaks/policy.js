// src/layers/outbreaks/policy.js
// CDC ArboNET (West Nile / arbovirus, U.S. federal public domain) +
// WHO Disease Outbreak News (CC BY-NC-SA 3.0 IGO — NON-COMMERCIAL ONLY).
// The two halves are never merged without a source label: CDC is the
// county-relevant half (West Nile is the mosquito-season angle for Cape
// May County), WHO is international context only — a US county pin is
// CDC, never WHO.
//
// Verified live 2026-11-17: the CDC current-year dashboard JSON
// (current-data.json, 32,086 B) lists live CSVs under
// wcms/vizdata/live/ncezid_dvbd/WNV/ — CountbyState (NJ 35 reported
// cases this season) and hum_nonhum (county human + non-human activity;
// Cape May Co FIPS 34009: non-human activity, 0 human cases). The
// "current as of" date lives only on the HTML page (November 10, 2026).
// The WHO OData endpoint returns 50 DONs (latest Nov 13, 2026: MERS –
// Qatar, DON626). The old WHO RSS URL 404s — do not build on it.
// CDC data are preliminary and subject to change; counts are shown with
// their as-of date, never as live.
export const OUTBREAKS_LAYER_ID = 'outbreaks';
export const OUTBREAKS_OVERLAY_SOURCE_ID = 'outbreaks';
export const OUTBREAKS_ATTRIBUTION =
  'CDC ArboNET (public domain) · WHO Disease Outbreak News (CC BY-NC-SA 3.0 IGO, non-commercial)';
export const OUTBREAKS_CDC_ATTRIBUTION = 'CDC ArboNET';
export const OUTBREAKS_WHO_ATTRIBUTION = 'WHO Disease Outbreak News';
export const CDC_DASHBOARD_JSON_URL =
  'https://www.cdc.gov/west-nile-virus/data-maps/current-data.json';
export const CDC_CURRENT_YEAR_PAGE_URL =
  'https://www.cdc.gov/west-nile-virus/data-maps/current-year-data.html';
export const CDC_WNV_CSV_BASE =
  'https://www.cdc.gov/wcms/vizdata/live/ncezid_dvbd/WNV';
export const CDC_COUNT_BY_STATE_CSV = 'wnv_hum_current_CountbyState.csv';
export const CDC_HUM_NONHUM_CSV = 'wnv_current_hum_nonhum.csv';
export const WHO_DON_ODATA_URL =
  'https://www.who.int/api/emergencies/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en&$orderby=PublicationDateAndTime%20desc&$expand=EmergencyEvent&$select=Title,TitleSuffix,OverrideTitle,UseOverrideTitle,regionscountries,ItemDefaultUrl,FormattedDate,PublicationDateAndTime';
/** Cape May County FIPS code (ArboNET county column is FIPS, not a name). */
export const OUTBREAKS_CAPE_MAY_FIPS = '34009';
export const OUTBREAKS_NJ_STATE_CODE = 'NJ';
/** The provider polls once per day; the layer refreshes on the same cycle. */
export const OUTBREAKS_REFRESH_MS = 24 * 60 * 60_000;
/** One county-seat anchor label, following the fuel layer. */
export const OUTBREAKS_OVERLAY_COHORT_LIMIT = 1;
/** WHO DON items shipped to the client per refresh. */
export const OUTBREAKS_DON_LIMIT = 20;
/** New Jersey county FIPS codes → names (alphabetical FIPS assignment). */
export const OUTBREAKS_NJ_COUNTIES = Object.freeze({
  34001: 'Atlantic',
  34003: 'Bergen',
  34005: 'Burlington',
  34007: 'Camden',
  34009: 'Cape May',
  34011: 'Cumberland',
  34013: 'Essex',
  34015: 'Gloucester',
  34017: 'Hudson',
  34019: 'Hunterdon',
  34021: 'Mercer',
  34023: 'Middlesex',
  34025: 'Monmouth',
  34027: 'Morris',
  34029: 'Ocean',
  34031: 'Passaic',
  34033: 'Salem',
  34035: 'Somerset',
  34037: 'Sussex',
  34039: 'Union',
  34041: 'Warren',
});
