/**
 * Cape feeds mapped to native GEV surfaces.
 * `/api/cape/*` is an in-app quiet store (optional external FIREWIRE_URL).
 * Prefer these natives when collectors have not published yet.
 */
export const CAPE_NATIVE_FALLBACKS = Object.freeze([
  {
    cape: 'cape-tomtom / tomtom/*',
    native: 'GEV TomTom tiles (TOMTOM_API_KEY) + traffic overlays',
  },
  {
    cape: 'cape-nws / hazards / feeds',
    native: 'GEV weather / NWS-adjacent layers + /api/ops/board NWS chips',
  },
  {
    cape: 'cape-cameras / cape CCTV pack',
    native: 'DelDOT + FAA WeatherCams packs; Fire Wire catalog when configured',
  },
  {
    cape: 'CAD / radio (public-safety SDR)',
    native:
      'In-app Fire Wire quiet store + /ops/firewire · /ops/scanners (SDR)',
  },
  {
    cape: 'ATC / LiveATC',
    native: 'GEV /ops/atc Icecast proxy + transcript ingest (old Cape program)',
  },
  {
    cape: 'board / news wire',
    native:
      '/api/ops/board aggregator (NWS + flood + outages); Fire Wire board optional',
  },
  {
    cape: 'floodwatch / flood_gauges / storms / outages',
    native:
      '/api/ops/flood + /api/ops/outages (native first); Fire Wire collectors optional',
  },
  {
    cape: '/place /timeline hydrants',
    native: 'GEV /ops/* desks (Place, Hydrants, Timeline, …)',
  },
  {
    cape: 'whale_zones',
    native: 'DATA LAYERS → Cape May → Whale zones + /ops/whales',
  },
]);

export function capeNativeFallbackSummary() {
  return CAPE_NATIVE_FALLBACKS.map((row) => `${row.cape} → ${row.native}`).join(
    '\n',
  );
}
