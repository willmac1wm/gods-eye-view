/**
 * @module faaWeatherCams
 *
 * Pure mapping for the FAA WeatherCams CCTV source pack.
 * Catalog URL matches WorldView (`weathercams.faa.gov/api/v1/cameras`).
 * Image URLs are pinned to FAA hosts before the CCTV proxy will fetch them.
 * No API keys live in this file; an optional env key is applied by the proxy.
 */

export const FAA_WEATHERCAMS_CATALOG_URL = 'https://weathercams.faa.gov/api/v1/cameras';
export const DEFAULT_FAA_MAX_SOURCES = 200;
export const FAA_WEATHERCAMS_SOURCE_KIND = 'faa-weathercams';

/** Airport / mountain-pass anchors — WeatherCams are not city intersections. */
export const FAA_WEATHERCAM_ANCHORS = Object.freeze([
  { lat: 61.1743, lon: -149.9963 }, // PANC Anchorage
  { lat: 64.8151, lon: -147.8563 }, // PAFA Fairbanks
  { lat: 58.3548, lon: -134.5763 }, // PAJN Juneau
  { lat: 47.4502, lon: -122.3088 }, // KSEA Seattle
  { lat: 45.5898, lon: -122.5951 }, // KPDX Portland
  { lat: 37.6213, lon: -122.3790 }, // KSFO San Francisco
  { lat: 39.8561, lon: -104.6737 }, // KDEN Denver
  { lat: 40.6413, lon: -73.7781 }, // KJFK New York
  { lat: 33.6407, lon: -84.4277 }, // KATL Atlanta
  { lat: 32.8998, lon: -97.0403 }, // KDFW Dallas
  { lat: 21.3187, lon: -157.9224 }, // PHNL Honolulu
]);

export function isFaaWeatherCamImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, 'https://weathercams.faa.gov/');
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'weathercams.faa.gov'
      || host.endsWith('.weathercams.faa.gov')
      || host === 'faa.gov'
      || host.endsWith('.faa.gov');
  } catch {
    return false;
  }
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function text(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

/**
 * Unwrap the FAA catalog payload. WorldView expected a top-level array;
 * the current API wraps `{ success, payload, error }`.
 */
export function extractFaaCameraRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.payload)) return payload.payload;
  if (payload.payload && Array.isArray(payload.payload.cameras)) return payload.payload.cameras;
  if (payload.payload && Array.isArray(payload.payload.sites)) {
    return flattenSiteCameras(payload.payload.sites);
  }
  if (Array.isArray(payload.cameras)) return payload.cameras;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.sites)) return flattenSiteCameras(payload.sites);
  return [];
}

function flattenSiteCameras(sites) {
  const cameras = [];
  for (const site of sites) {
    if (!site || typeof site !== 'object') continue;
    const nested = Array.isArray(site.cameras) ? site.cameras : [site];
    for (const camera of nested) {
      if (!camera || typeof camera !== 'object') continue;
      cameras.push({
        ...camera,
        siteDescription: camera.siteDescription || site.siteDescription || site.name || site.siteName,
        latitude: camera.latitude ?? camera.lat ?? site.latitude ?? site.lat,
        longitude: camera.longitude ?? camera.lon ?? site.longitude ?? site.lon,
      });
    }
  }
  return cameras;
}

function resolveImageUrl(record) {
  const candidates = [
    record.imageUrl,
    record.imageURL,
    record.thumbnailUrl,
    record.thumbnailURL,
    record.imageUri,
    record.currentImageUrl,
    record.url,
  ];
  for (const candidate of candidates) {
    const raw = text(candidate);
    if (!raw) continue;
    try {
      const absolute = new URL(raw, 'https://weathercams.faa.gov/').toString();
      if (isFaaWeatherCamImageUrl(absolute)) return absolute;
    } catch {
      // skip malformed
    }
  }
  return null;
}

function resolveLatLon(record) {
  const lat = finiteNumber(record.latitude ?? record.lat ?? record.cameraLatitude);
  const lon = finiteNumber(record.longitude ?? record.lon ?? record.lng ?? record.cameraLongitude);
  if (lat == null || lon == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Map one FAA WeatherCams catalog row into GEV's CCTV source shape.
 * Airports / weather sites only — no intersection-camera fallback.
 * @returns {object|null}
 */
export function mapFaaWebcamRecord(record, headingFromDirection) {
  if (!record || typeof record !== 'object') return null;
  const coords = resolveLatLon(record);
  if (!coords) return null;
  const imageUrl = resolveImageUrl(record);
  if (!imageUrl) return null;
  const rawId = text(record.id) || text(record.cameraId) || text(record.cameraID);
  if (!rawId) return null;
  const site = text(record.siteDescription) || text(record.siteName) || text(record.airportId) || 'FAA WeatherCam';
  const name = text(record.description) || text(record.name) || text(record.cameraName) || site;
  const direction = record.cameraDirection || record.direction || record.heading;
  const headingDeg = typeof headingFromDirection === 'function'
    ? headingFromDirection(direction, true)
    : finiteNumber(direction);
  const hasHeading = Number.isFinite(headingDeg);

  return {
    id: `faa-${rawId}`,
    name: name.includes(site) ? name : `${name} (${site})`,
    city: site,
    cityId: 'faa-weathercams',
    provider: 'FAA WeatherCams',
    lat: coords.lat,
    lon: coords.lon,
    headingDeg: hasHeading ? headingDeg : undefined,
    headingConfidence: hasHeading ? 'high' : 'low',
    pitchDeg: hasHeading ? -18 : -12,
    fovDeg: hasHeading ? 56 : 44,
    rangeM: hasHeading ? 2400 : 1800,
    mountHeightM: 12,
    groundElevationM: 50,
    feedType: 'image',
    url: imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: FAA_WEATHERCAMS_SOURCE_KIND,
    license: 'FAA WeatherCams public aviation camera',
  };
}

export function mapFaaWebcamCatalog(payload, headingFromDirection) {
  const records = extractFaaCameraRecords(payload);
  const mapped = [];
  const seen = new Set();
  for (const record of records) {
    const camera = mapFaaWebcamRecord(record, headingFromDirection);
    if (!camera || seen.has(camera.id)) continue;
    seen.add(camera.id);
    mapped.push(camera);
  }
  return mapped;
}
