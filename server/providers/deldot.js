// Public DOT traffic cameras for the cape-cameras layer — DelDOT.
// Port of the old app's app/traffic_cameras.py (same sources, same
// filters, same payload shape so src/layers/capeDispatch/model.js
// mapCameras() works unchanged). Keyless.
//
//   - Seed: Cape May–Lewes Ferry terminal + coastal bridge cameras
//     (the old ferry_cams list; the 10 DRBA ferry webcams come from the
//     shared public bundle, the harbour + 4 bridge pins are static here).
//   - Live: DelDOT TMC video cameras (https://tmc.deldot.gov/json/
//     videocamera.json) — direct m3u8 stream URLs; Sussex County & the
//     Lewes / Cape May corridor only.
//   - Fallback: DelDOT ArcGIS FeatureServer layer 26
//     (Transportation/DE_Boundary_and_Point, "Traffic Devices - CAMERA").
//
// Field names for the ArcGIS layer were never confirmed against a live
// response (the old environment could not reach Delaware's ArcGIS host),
// so _parseCamera tries several plausible field-name variants per
// attribute and keeps anything unrecognised in `extra`. Verify field
// names against a live response on first deploy and simplify the
// fallback chain once confirmed.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { CAPE_PUBLIC_WEBCAMS } from '../../src/layers/capeDispatch/publicWebcams.js';

const TMC_URL = 'https://tmc.deldot.gov/json/videocamera.json';
const ARCGIS_URL =
  'https://enterprise.firstmap.delaware.gov/arcgis/rest/services/' +
  'Transportation/DE_Boundary_and_Point/FeatureServer/26/query';
const ARCGIS_PARAMS = {
  where: '1=1',
  outFields: '*',
  f: 'geojson',
  returnGeometry: 'true',
  outSR: '4326',
};

const CACHE_MS = 900_000; // 15 minutes; camera inventory changes rarely
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

// DelDOT confirmed field names: PUBLIC_NAME, LOCATION, MAINROAD,
// INTERSECTION, SYSTEM_STATUS.
const NAME_FIELDS = [
  'PUBLIC_NAME',
  'Name',
  'NAME',
  'CameraName',
  'Location',
  'LOCATION',
  'Label',
];
const URL_FIELDS = [
  'ImageURL',
  'Image_URL',
  'URL',
  'Url',
  'VideoURL',
  'StreamURL',
];
const ROAD_FIELDS = ['MAINROAD', 'Route', 'ROUTE', 'RoadName', 'Roadway'];

/** Ferry terminal + coastal bridge cameras (old ferry_cams list, minus the
 * 10 DRBA ferry webcams that live in the shared public bundle). The
 * bridge pins carry no playable media — they are location pins the
 * panel reports as "no public feed". */
export const FERRY_BRIDGE_CAMERAS = Object.freeze([
  Object.freeze({
    name: 'Cape May Harbor & Inlet (USCG TRACEN)',
    lat: 38.9482,
    lng: -74.889,
    road: 'Cape May Harbor / USCG Base',
    image_url: 'https://cdn.jwplayer.com/thumbs/uPdLa13e-720.jpg',
    source: 'Cape May Harbor Watch',
    heading: 110,
    fov: 65,
    heading_confidence: 'high',
    extra: { city: 'Cape May' },
  }),
  Object.freeze({
    name: "Townsend's Inlet Bridge (Ocean Drive)",
    lat: 39.1175,
    lng: -74.717,
    road: 'Ocean Drive Bridge',
    image_url: null,
    source: 'Cape May County Bridge Commission',
    heading: 20,
    fov: 60,
    heading_confidence: 'high',
    extra: { city: 'Avalon / Sea Isle City' },
  }),
  Object.freeze({
    name: 'Middle Thorofare Bridge (Two Mile Landing)',
    lat: 38.961,
    lng: -74.872,
    road: 'Ocean Drive Toll Bridge',
    image_url: null,
    source: 'Cape May County Bridge Commission',
    heading: 45,
    fov: 60,
    heading_confidence: 'high',
    extra: { city: 'Wildwood Crest / Cape May' },
  }),
  Object.freeze({
    name: 'Grassy Sound Bridge (Route 147)',
    lat: 39.0185,
    lng: -74.821,
    road: 'NJ-147 / Grassy Sound',
    image_url: null,
    source: 'Cape May County Bridge Commission',
    heading: 75,
    fov: 60,
    heading_confidence: 'high',
    extra: { city: 'North Wildwood' },
  }),
  Object.freeze({
    name: "Corson's Inlet Bridge (Ocean Drive)",
    lat: 39.213,
    lng: -74.654,
    road: 'Ocean Drive Bridge',
    image_url: null,
    source: 'Cape May County Bridge Commission',
    heading: 35,
    fov: 60,
    heading_confidence: 'high',
    extra: { city: 'Strathmere / Ocean City' },
  }),
]);

/** The static seed: DRBA ferry webcams (traffic schema) + bridge pins. */
export function ferryTrafficSeed() {
  const seed = (CAPE_PUBLIC_WEBCAMS.cameras || []).map((cam) => ({
    name: cam.title,
    image_url: cam.image_url || null,
    player_url: cam.player_url || null,
    stream_url: cam.stream_url || null,
    road: cam.road || 'Ferry Terminal',
    lat: cam.lat,
    lng: cam.lng,
    heading: cam.heading ?? null,
    fov: cam.fov ?? 60,
    heading_confidence: cam.heading_confidence || 'high',
    source: cam.source,
    extra: { city: cam.city },
  }));
  for (const cam of FERRY_BRIDGE_CAMERAS) seed.push({ ...cam });
  return seed;
}

function firstPresent(props, candidates) {
  for (const key of candidates) {
    const value = props?.[key];
    if (value != null && value !== '') return String(value);
  }
  return null;
}

/** Return (heading, fov, confidence) from camera metadata or title. */
export function parseHeading(title, props = {}) {
  for (const key of [
    'HEADING',
    'Heading',
    'bearing',
    'BEARING',
    'AZIMUTH',
    'Azimuth',
  ]) {
    if (props[key] != null && props[key] !== '') {
      const parsed = Number(props[key]);
      if (Number.isFinite(parsed)) return [parsed % 360, 60.0, 'high'];
    }
  }
  const t = ` ${String(title || '').toUpperCase()} ${String(props.MAINROAD || '').toUpperCase()} ${String(props.VIEW || '').toUpperCase()} `;
  const compass = [
    [' NB ', 'NORTHBOUND', 'LOOKING N', 0.0],
    [' NE ', 'NORTHEAST', null, 45.0],
    [' EB ', 'EASTBOUND', 'LOOKING E', 90.0],
    [' SE ', 'SOUTHEAST', null, 135.0],
    [' SB ', 'SOUTHBOUND', 'LOOKING S', 180.0],
    [' SW ', 'SOUTHWEST', null, 225.0],
    [' WB ', 'WESTBOUND', 'LOOKING W', 270.0],
    [' NW ', 'NORTHWEST', null, 315.0],
  ];
  for (const [token, word, looking, degrees] of compass) {
    if (
      t.includes(token) ||
      (word && t.includes(word)) ||
      (looking && t.includes(looking))
    ) {
      return [degrees, 60.0, 'estimated'];
    }
  }
  return [null, 60.0, 'estimated'];
}

export function parseArcGisCamera(feature) {
  const coords = feature?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lng, lat] = coords;
  const props = feature?.properties || {};
  const known = new Set([...NAME_FIELDS, ...URL_FIELDS, ...ROAD_FIELDS]);
  const name = firstPresent(props, NAME_FIELDS) || 'Traffic camera';
  const [heading, fov, confidence] = parseHeading(name, props);
  return {
    name,
    image_url: firstPresent(props, URL_FIELDS),
    road: firstPresent(props, ROAD_FIELDS),
    lat,
    lng,
    heading,
    fov,
    heading_confidence: confidence,
    source: 'DelDOT',
    extra: Object.fromEntries(
      Object.entries(props).filter(([key]) => !known.has(key)),
    ),
  };
}

function inCorridor(lat, lon) {
  return lat >= 38.4 && lat <= 39.2 && lon >= -75.8 && lon <= -75.0;
}

/** DelDOT TMC videoCameras -> traffic-camera rows (corridor only). */
export function parseTmcCameras(payload) {
  const out = [];
  for (const v of payload?.videoCameras || []) {
    if (v?.enabled === false) continue;
    const lat = v?.lat;
    const lon = v?.lon;
    if (lat == null || lon == null) continue;
    const county = String(v?.county || '').toLowerCase();
    // Sussex County & Lewes/Cape May corridor.
    if (!(county === 'sussex' || inCorridor(lat, lon))) continue;
    const urls = v?.urls || {};
    const streamUrl = urls.m3u8s || urls.m3u8 || urls.rtmp || null;
    const title = v?.title || 'Traffic camera';
    const road = title.includes('@') ? title.split('@')[0].trim() : null;
    const [heading, fov, confidence] = parseHeading(title, v);
    out.push({
      name: title,
      image_url: streamUrl,
      road,
      lat,
      lng: lon,
      heading,
      fov,
      heading_confidence: confidence,
      source: 'DelDOT TMC',
      extra: { county: v?.county, id: v?.id },
    });
  }
  return out;
}

async function fetchJson(fetchImpl, url, params) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const query = params ? `?${new URLSearchParams(params)}` : '';
  const response = await fetchImpl(`${url}${query}`, { signal });
  if (!response.ok) throw new Error(`deldot_upstream_${response.status}`);
  return readResponseJsonCapped(response, MAX_RESPONSE_BYTES, signal);
}

export function deldotProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load() {
    const seed = ferryTrafficSeed();
    const out = [...seed];
    // Try live DelDOT TMC video cameras first (has direct m3u8 URLs).
    try {
      const tmc = parseTmcCameras(await fetchJson(fetchImpl, TMC_URL));
      if (tmc.length) return { cameras: [...out, ...tmc], fetched_at: now() };
    } catch {
      /* fall through to ArcGIS */
    }
    // Fallback to ArcGIS FeatureServer/26 GeoJSON query.
    const data = await fetchJson(fetchImpl, ARCGIS_URL, ARCGIS_PARAMS);
    for (const feature of data?.features || []) {
      const parsed = parseArcGisCamera(feature);
      if (parsed) out.push(parsed);
    }
    return { cameras: out, fetched_at: now() };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) {
      return json(200, {
        cameras: cache.cameras,
        error: null,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    }
    try {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, {
        cameras: cache.cameras,
        error: null,
        age_s: Math.floor((t - cache.fetched_at) / 1000),
      });
    } catch (error) {
      if (cache) {
        return json(200, {
          cameras: cache.cameras,
          error: null,
          age_s: Math.floor((t - cache.fetched_at) / 1000),
          stale: true,
        });
      }
      return json(502, {
        error: 'deldot_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'deldot-cameras',
    configureServer({ middlewares }) {
      middlewares.use('/api/deldot-cameras', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/deldot-cameras', handler);
    },
  };
}
