/**
 * Cape feeds that leave the retired website for Fire Wire or native GEV.
 * When Fire Wire is offline, operators should use these GEV surfaces instead
 * of expecting `/api/cape/*` to talk to capemaydispatch.com.
 */
export const CAPE_NATIVE_FALLBACKS = Object.freeze([
  {
    cape: 'cape-tomtom / tomtom/*',
    native: 'GEV TomTom tiles (TOMTOM_API_KEY) + traffic overlays',
  },
  {
    cape: 'cape-nws / hazards / feeds',
    native: 'GEV weather / NWS-adjacent layers already on the globe',
  },
  {
    cape: 'cape-cameras / cape CCTV pack',
    native: 'DelDOT + FAA WeatherCams packs; Fire Wire catalog when configured',
  },
  {
    cape: 'board / news wire / CAD / radio',
    native: 'Fire Wire API only (SDR for radio later)',
  },
  {
    cape: 'floodwatch / flood_gauges / sar/flood / storms / outages',
    native: 'Fire Wire collectors until ported; strip stays empty-tolerant',
  },
]);

export function capeNativeFallbackSummary() {
  return CAPE_NATIVE_FALLBACKS.map((row) => `${row.cape} → ${row.native}`).join(
    '\n',
  );
}
