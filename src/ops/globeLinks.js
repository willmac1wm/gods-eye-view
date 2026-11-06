/**
 * Deep-links from ops desks → GEV globe with Cape layer handoffs.
 * Uses share-link v2 layer tokens for registered Cape layers.
 */

/** Token map mirrored from src/data/layerState.js (Cape May block). */
const CAPE_LAYER_TOKENS = Object.freeze({
  'cape-airports': '00',
  'cape-buoys': '01',
  'cape-cad': '02',
  'cape-cameras': '03',
  'cape-flood': '04',
  'cape-nws': '05',
  'cape-outages': '06',
  'cape-radio': '07',
  'cape-tfrs': '08',
  'cape-tomtom': '09',
  'cape-webcams': '0a',
  'cape-wind': '0b',
  'cape-whales': '0c',
});

/**
 * Build a globe URL that flies to a point and optionally enables Cape layers.
 */
export function globeHref({ lat, lon, layers = [], alt, panel } = {}) {
  const params = new URLSearchParams();
  if (Number.isFinite(lat)) params.set('lat', Number(lat).toFixed(5));
  if (Number.isFinite(lon)) params.set('lon', Number(lon).toFixed(5));
  if (Number.isFinite(alt)) params.set('alt', String(Math.round(alt)));

  const tokens = [];
  for (const id of layers) {
    const token = CAPE_LAYER_TOKENS[id];
    if (token) tokens.push(token);
  }
  if (tokens.length) {
    params.set('v', '2');
    params.set('l', tokens.join('.'));
  }
  if (panel) params.set('panel', String(panel));

  const q = params.toString();
  return q ? `/?${q}` : '/';
}

/** Matrix rows for Managers “Globe visibility” UI. */
export const GLOBE_VISIBILITY_MATRIX = Object.freeze([
  {
    desk: 'Incidents / CAD',
    strip: 'CAD section + fly links',
    layer: 'cape-cad',
    handoff: 'strip · DATA LAYERS · /?l=02',
    status: 'live',
  },
  {
    desk: 'Cameras',
    strip: 'ops link',
    layer: 'cape-cameras / cape-webcams',
    handoff: 'CCTV panel · DATA LAYERS · /?l=03.0a',
    status: 'live',
  },
  {
    desk: 'Scanners / RADIO',
    strip: 'Scanner feeds → requestCapeRadio',
    layer: 'cape-radio',
    handoff: 'RADIO panel · strip buttons · /?l=07',
    status: 'live',
  },
  {
    desk: 'Flood',
    strip: 'Tide / Flood map / Gauges',
    layer: 'cape-flood',
    handoff: 'strip · DATA LAYERS · /?l=04',
    status: 'live',
  },
  {
    desk: 'Board',
    strip: 'Official chips + news wire',
    layer: '— (chips in strip)',
    handoff: 'strip chips only',
    status: 'live',
  },
  {
    desk: 'Social / News',
    strip: 'News wire section',
    layer: '—',
    handoff: 'strip news · /ops/social · /ops/news',
    status: 'live',
  },
  {
    desk: 'Aviation',
    strip: 'Marine & WX / METAR',
    layer: 'cape-airports / cape-tfrs',
    handoff: 'Movement ADS-B on globe · /?l=00.08',
    status: 'live',
  },
  {
    desk: 'ATC',
    strip: 'ops link',
    layer: 'cape-airports / cape-tfrs (charts on desk)',
    handoff: '/ops/atc Icecast + transcript · globe /?l=00.08',
    status: 'live',
  },
  {
    desk: 'Fire Wire',
    strip: 'ops link',
    layer: '—',
    handoff: '/ops/firewire managers tools + ATC ingest health',
    status: 'ops',
  },
  {
    desk: 'Whales',
    strip: 'ops link',
    layer: 'cape-whales',
    handoff: 'DATA LAYERS · /?v=2&l=0c · lat/lon fly',
    status: 'live',
  },
  {
    desk: 'Place / Hydrants / Timeline',
    strip: 'ops links w/ camera lat/lon',
    layer: '—',
    handoff: 'deep-link to /ops/* then back via /?lat&lon',
    status: 'live',
  },
  {
    desk: 'Outages / NWS / TomTom',
    strip: 'Outages · NWS · TomTom sections',
    layer: 'cape-outages / cape-nws / cape-tomtom',
    handoff: 'DATA LAYERS · /?l=06.05.09',
    status: 'live',
  },
  {
    desk: 'Messages / AI / Managers',
    strip: 'Managers link',
    layer: '—',
    handoff: 'ops-only (no globe geometry)',
    status: 'ops',
  },
]);
