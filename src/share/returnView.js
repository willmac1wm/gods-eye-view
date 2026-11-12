/**
 * Where a sign-in round trip should land.
 *
 * Leaving for `/login` or `/auth/*` (the apex 307s those to
 * app.capemaydispatch.com) drops or corrupts the hash. A valid hash is kept.
 * Otherwise the last valid view stored before the trip is used. Cape May is
 * the fallback. Null island is never a landing place.
 */

import {
  CAPE_MAY_STARTUP_VIEW,
  finiteNumber,
  formatsAsNullIsland,
  normalizeSharedCamera,
} from './cameraParams.js';

export const LAST_VALID_VIEW_KEY = 'gev:last-valid-view:v1';

const SAME_SITE = new Set([
  'capemaydispatch.com',
  'www.capemaydispatch.com',
  'app.capemaydispatch.com',
  'localhost',
  '127.0.0.1',
]);

export function capeMayViewHash() {
  const view = CAPE_MAY_STARTUP_VIEW;
  return `v=2&lat=${view.lat.toFixed(4)}&lon=${view.lon.toFixed(4)}&alt=${view.alt}&heading=${view.heading}&pitch=${view.pitch}&roll=${view.roll}`;
}

/** True when the hash names a finite camera that is not null island. */
export function hashCameraIsValid(hash) {
  const text = String(hash || '').replace(/^#/, '').trim();
  if (!text) return false;
  const params = new URLSearchParams(text);
  if (!params.has('lat') || !params.has('lon')) return false;
  const lat = finiteNumber(params.get('lat'));
  const lon = finiteNumber(params.get('lon'));
  if (lat == null || lon == null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return !formatsAsNullIsland(lat, lon);
}

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Remember a hash only when its camera is a real place. */
export function rememberValidView(hash, storage) {
  const text = String(hash || '').replace(/^#/, '');
  if (!hashCameraIsValid(text)) return false;
  try {
    storageOf(storage)?.setItem?.(LAST_VALID_VIEW_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function readLastValidView(storage) {
  try {
    const raw = storageOf(storage)?.getItem?.(LAST_VALID_VIEW_KEY);
    return hashCameraIsValid(raw) ? String(raw).replace(/^#/, '') : null;
  } catch {
    return null;
  }
}

/**
 * Hash to open after auth. A valid incoming hash wins, then the saved view,
 * then Cape May.
 * @param {{hash?: string, saved?: string|null}} input
 */
export function viewHashAfterReturn({ hash = '', saved = null } = {}) {
  const incoming = String(hash || '').replace(/^#/, '');
  if (hashCameraIsValid(incoming)) return incoming;
  if (hashCameraIsValid(saved)) return saved;
  return capeMayViewHash();
}

function allowedAbsolute(url) {
  const host = url.hostname.toLowerCase();
  return SAME_SITE.has(host) || host.endsWith('.capemaydispatch.com');
}

/**
 * A post-login `next` / `returnTo` / OAuth return. Open redirects are dropped.
 * A valid hash or query camera is kept. Null island and a missing camera
 * become a hashless `/` so the app can apply the saved view or Cape May.
 * @param {string} raw
 * @returns {string} A same-site path, query, and hash.
 */
export function sanitizeReturnTarget(raw) {
  const text = String(raw || '').trim();
  if (!text) return '/';
  let url;
  try {
    url = new URL(text, 'https://capemaydispatch.com');
  } catch {
    return '/';
  }
  const relative = text.startsWith('/') && !text.startsWith('//');
  if (!relative && !allowedAbsolute(url)) return '/';
  const lat = finiteNumber(url.searchParams.get('lat'));
  const lon = finiteNumber(url.searchParams.get('lon'));
  const queryCamera =
    url.searchParams.has('lat') || url.searchParams.has('lon');
  if (queryCamera && (lat == null || lon == null || formatsAsNullIsland(lat, lon))) {
    url.searchParams.delete('lat');
    url.searchParams.delete('lon');
  }
  if (!hashCameraIsValid(url.hash)) url.hash = '';
  const path = `${url.pathname}${url.search}${url.hash}` || '/';
  if (!relative && allowedAbsolute(url)) {
    return `${url.origin}${path === '//' ? '/' : path}`;
  }
  return path.startsWith('/') ? path : '/';
}

/** Camera to fly when the page has no usable share hash. */
export function startupCameraAfterReturn({ hash = '', storage } = {}) {
  const chosen = viewHashAfterReturn({
    hash,
    saved: readLastValidView(storage),
  });
  const params = new URLSearchParams(chosen);
  return normalizeSharedCamera({
    lat: params.get('lat'),
    lon: params.get('lon'),
    alt: params.get('alt'),
    heading: params.get('heading'),
    pitch: params.get('pitch'),
    roll: params.get('roll'),
  });
}

/**
 * Where `/login` sends the browser after a session exists. A valid `next`
 * hash wins; otherwise the saved view; otherwise Cape May.
 * @param {string} nextUrl
 * @param {Storage} [storage]
 */
export function landingAfterSignIn(nextUrl, storage) {
  const sanitized = sanitizeReturnTarget(nextUrl);
  let url;
  try {
    url = new URL(sanitized, 'https://capemaydispatch.com');
  } catch {
    url = new URL('https://capemaydispatch.com/');
  }
  const hash = viewHashAfterReturn({
    hash: url.hash,
    saved: readLastValidView(storage),
  });
  if (hashCameraIsValid(url.hash)) {
    return sanitized.startsWith('http')
      ? sanitized
      : `${url.pathname}${url.search}${url.hash}`;
  }
  return `/#${hash}`;
}

/** `/login?next=` that carries a valid view and never a 0,0 hash. */
export function signInHref(location, storage) {
  const hash = location?.hash || '';
  if (hashCameraIsValid(hash)) rememberValidView(hash, storage);
  const nextHash = viewHashAfterReturn({
    hash,
    saved: readLastValidView(storage),
  });
  const next = sanitizeReturnTarget(`/#${nextHash}`);
  return `/login?next=${encodeURIComponent(next)}`;
}
