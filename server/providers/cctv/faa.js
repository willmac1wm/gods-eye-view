/**
 * FAA WeatherCams CCTV pack (airports and mountain passes).
 * The public catalog returns 401 without credentials; an optional
 * FAA_WEATHERCAMS_API_KEY is forwarded when set. Failures return [] so
 * the other camera packs stay up. No key is required for the rest of GEV.
 */
import { CCTV_SOURCE_FETCH_TIMEOUT_MS } from './constants.js';
import { fallbackHeadingFromId, prioritizeSources } from './normalize.js';
import { directionToHeading } from '../../../src/data/directionText.js';
import {
  DEFAULT_FAA_MAX_SOURCES,
  FAA_WEATHERCAM_ANCHORS,
  FAA_WEATHERCAMS_CATALOG_URL,
  mapFaaWebcamCatalog,
} from '../../../src/data/faaWeatherCams.js';

export async function loadFaaWebcamSourcesFromOpenData() {
  const endpoint =
    process.env.CCTV_FAA_CATALOG_URL || FAA_WEATHERCAMS_CATALOG_URL;
  const apiKey = String(
    process.env.FAA_WEATHERCAMS_API_KEY || process.env.CCTV_FAA_API_KEY || '',
  ).trim();
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'gods-eye-view-cctv-proxy/1.0',
    Referer: 'https://weathercams.faa.gov/',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['X-API-Key'] = apiKey;
  }
  try {
    const resp = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(
        '[CCTV] FAA WeatherCams catalog failed:',
        resp.status,
        apiKey
          ? '(key rejected or unauthorized)'
          : '(no API key; catalog is 401 without credentials)',
      );
      return [];
    }
    const payload = await resp.json();
    const cameras = mapFaaWebcamCatalog(payload, directionToHeading);
    for (const camera of cameras) {
      if (!Number.isFinite(camera.headingDeg)) {
        camera.headingDeg = fallbackHeadingFromId(camera.id);
        camera.headingConfidence = 'low';
      }
    }
    const maxRaw = Number(
      process.env.CCTV_FAA_MAX_SOURCES || DEFAULT_FAA_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_FAA_MAX_SOURCES;
    const prioritized = prioritizeSources(
      cameras,
      maxCount,
      FAA_WEATHERCAM_ANCHORS,
    );
    console.log(
      `[CCTV] Loaded FAA WeatherCams: ${cameras.length} airport cameras (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] FAA WeatherCams catalog error:',
      error?.message || error,
    );
    return [];
  }
}
