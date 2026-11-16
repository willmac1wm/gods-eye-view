/**
 * USGS gauge registry. Coordinates verified against the USGS pages
 * 2026-11-16. Only gauges confirmed live on the new Water Data API v1
 * belong here:
 * - 01411000 Great Egg Harbor River at Folsom, NJ (Atlantic County)
 * - 01411300 Tuckahoe River at Head of River, NJ (Cape May County — the
 *   only confirmed live gauge physically in the county)
 * Excluded: 01411175 (stale since 2026-09-26) and 01411315 (Great Egg
 * Harbor Bay at Beesleys Point — exists as a monitoring location but
 * returns zero latest-continuous features, i.e. no live telemetry).
 */
export const GAUGES_SITES = Object.freeze([
  Object.freeze({
    id: '01411000',
    name: 'Great Egg Harbor River at Folsom, NJ',
    shortName: 'Great Egg Harbor R. — Folsom',
    lat: 39.5947,
    lon: -74.8517,
  }),
  Object.freeze({
    id: '01411300',
    name: 'Tuckahoe River at Head of River, NJ',
    shortName: 'Tuckahoe R. — Head of River',
    lat: 39.3069,
    lon: -74.8206,
  }),
]);

export const GAUGES_SITES_BY_ID = Object.freeze(
  Object.fromEntries(GAUGES_SITES.map((site) => [site.id, site])),
);

/** USGS parameter codes: 00060 discharge (ft³/s), 00065 gage height (ft). */
export const GAUGES_PARAMETERS = Object.freeze({
  discharge: '00060',
  gageHeight: '00065',
});
