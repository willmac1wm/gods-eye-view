// Cape camera catalog → the app CCTV source format. No Cesium, no network.
import { msg } from '../../i18n/marker.js';
import { CAPE_BBOX } from '../../region/mode.js';

const text = (value) => String(value ?? '').trim();

function inRegion(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= CAPE_BBOX.west &&
    lon <= CAPE_BBOX.east &&
    lat >= CAPE_BBOX.south &&
    lat <= CAPE_BBOX.north
  );
}

function positionOf(camera) {
  const lat = Number(camera?.lat ?? camera?.latitude);
  const lon = Number(camera?.lng ?? camera?.lon ?? camera?.longitude);
  if (!inRegion(lon, lat)) return null;
  return { lon, lat };
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function streamToken(raw) {
  const match = String(raw || '').match(
    /\/live\/([A-Za-z0-9_.-]+?)(?:\.stream)?\/playlist\.m3u8/i,
  );
  return match ? match[1] : '';
}

/**
 * Stable CCTV id for one Cape catalog camera. `used` disambiguates a repeated
 * slug inside one list. Callers must walk cameras in the same order.
 */
export function capeCameraId(prefix, camera, index, used) {
  const stream =
    streamToken(camera?.stream_url) ||
    streamToken(camera?.image_url) ||
    streamToken(camera?.player_url);
  const basis =
    text(camera?.id) ||
    stream ||
    text(camera?.name || camera?.title) ||
    `n${index}`;
  const stem = slug(basis) || 'cam';
  let id = `cape-${prefix}-${stem}`;
  let n = 2;
  while (used?.has(id)) {
    id = `cape-${prefix}-${stem.slice(0, 40)}-${n}`;
    n += 1;
  }
  used?.add(id);
  return id;
}

function isStream(url) {
  return /\.m3u8(?:$|\?)/i.test(url);
}

/** Public http(s) URL, or a Cape fx still path. The old site's own pages are not feeds. */
export function capePublicUrl(raw) {
  const value = text(raw);
  if (!value) return '';
  if (value.startsWith('/api/') && !value.startsWith('/api/cape/')) {
    return capePublicUrl(value.replace(/^\/api\//, '/api/cape/'));
  }
  if (/^\/api\/cape\/fx\/cam\/[\w.-]+\.jpg$/.test(value)) return value;
  if (!/^https?:\/\//i.test(value)) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'capemaydispatch.com' ||
    host.endsWith('.capemaydispatch.com') ||
    url.username ||
    url.password
  )
    return '';
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  )
    url.port = '';
  return url.href;
}

/**
 * CCTV feed fields for one camera.
 * HLS wins. A still is the snapshot. An fx thumb stays relative until
 * `operatorBase` makes it an absolute URL the frame proxy can fetch.
 */
export function capeFeed(camera, operatorBase = '') {
  const stream = capePublicUrl(camera?.stream_url);
  const image = capePublicUrl(camera?.image_url || camera?.thumb);
  const player = capePublicUrl(camera?.player_url || camera?.url);
  const streamUrl =
    [stream, image, player].find(
      (url) => url && isStream(url) && /^https?:/i.test(url),
    ) || '';
  let still = image && !isStream(image) ? image : '';
  const relativeStill = still.startsWith('/');
  if (relativeStill && operatorBase) {
    still = `${String(operatorBase).replace(/\/+$/, '')}/api/${still.slice('/api/cape/'.length)}`;
  }
  const snapshotUrl = /^https?:/i.test(still) ? still : '';
  if (streamUrl) {
    return { feedType: 'hls', url: streamUrl, snapshotUrl, hasFeed: true };
  }
  if (snapshotUrl || relativeStill) {
    return {
      feedType: 'image',
      url: snapshotUrl,
      snapshotUrl,
      hasFeed: true,
    };
  }
  return { feedType: 'image', url: '', snapshotUrl: '', hasFeed: false };
}

function finiteIn(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/** One CCTV source object. Cameras with no public media are included so the panel can say so. */
export function capeCctvSource(item, operatorBase = '') {
  const camera = item.camera;
  const feed = capeFeed(camera, operatorBase);
  const heading = finiteIn(camera.heading ?? camera.headingDeg, 0, 359.999);
  const hasHeading = heading != null;
  const confidence = text(
    camera.heading_confidence || camera.headingConfidence,
  ).toLowerCase();
  const fov = finiteIn(camera.fov ?? camera.fovDeg, 20, 125);
  const city =
    text(camera.extra?.city || camera.city || camera.county) || 'Cape May';
  const provider = text(camera.source || camera.agency) || 'Cape May Dispatch';
  return {
    id: item.id,
    name: text(camera.name || camera.title) || item.label,
    city,
    cityId: 'cape-may',
    provider,
    lat: item.lat,
    lon: item.lon,
    headingDeg: hasHeading ? heading : undefined,
    headingConfidence: ['high', 'medium', 'low'].includes(confidence)
      ? confidence
      : hasHeading
        ? 'medium'
        : 'low',
    pitchDeg: hasHeading ? -24 : -18,
    fovDeg: fov ?? (hasHeading ? 56 : 44),
    rangeM: hasHeading ? 210 : 145,
    mountHeightM: hasHeading ? 10 : 8,
    groundElevationM: 5,
    feedType: feed.feedType,
    url: feed.url,
    snapshotUrl: feed.snapshotUrl,
    sourceKind: 'cape-dispatch',
    license: 'Cape May Dispatch camera catalog',
    credit: provider,
  };
}

const CAMERA_LISTS = [
  ['traffic', 'traffic', 'Traffic camera', '#00ffff'],
  ['nj511', 'nj511', '511NJ camera', '#ffd700'],
  ['fx', 'fx', 'Cape camera', '#00ff00'],
];

function normalizeCamera(camera, prefix) {
  if (prefix !== 'fx' || !camera || camera.image_url || !camera.thumb)
    return camera;
  return {
    ...camera,
    image_url: String(camera.thumb).replace(/^\/api\//, '/api/cape/'),
  };
}

/** Traffic, 511NJ, then fx. A shared location keeps the earlier camera. */
export function eachCapeCamera(payloads = {}, visit) {
  const seenLoc = new Set();
  const used = new Set();
  for (const [key, prefix, label, accent] of CAMERA_LISTS) {
    const cameras = payloads[key]?.cameras || [];
    cameras.forEach((raw, index) => {
      const camera = normalizeCamera(raw, prefix);
      const position = positionOf(camera);
      if (!position) return;
      const loc = `${position.lat.toFixed(4)},${position.lon.toFixed(4)}`;
      if (seenLoc.has(loc)) return;
      seenLoc.add(loc);
      visit({
        camera,
        id: capeCameraId(prefix, camera, index, used),
        prefix,
        label,
        accent,
        ...position,
      });
    });
  }
}

export function eachCapeWebcam(payload = {}, visit) {
  const used = new Set();
  (payload.cameras || []).forEach((camera, index) => {
    const position = positionOf(camera);
    if (!position) return;
    visit({
      camera,
      id: capeCameraId('webcam', camera, index, used),
      prefix: 'webcam',
      label: msg('Webcam'),
      accent: '#7fff00',
      ...position,
    });
  });
}

/** Every Cape camera and webcam as a CCTV source, nearest-list order preserved. */
export function capeCctvSources(payloads = {}, operatorBase = '') {
  const sources = [];
  const push = (item) => sources.push(capeCctvSource(item, operatorBase));
  eachCapeCamera(payloads, push);
  eachCapeWebcam(payloads.webcams, push);
  return sources;
}
