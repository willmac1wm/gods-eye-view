/**
 * Phone → Cesium-free /ops routing. Used by the blocking gate in index.html
 * (before main.js / Cesium) and by ops chrome for the escape hatch.
 */

export const PHONE_GLOBE_SESSION_KEY = 'gev-prefer-globe';
export const PHONE_MAX_WIDTH_MQ = '(max-width: 720px)';
export const PHONE_COARSE_MQ = '(hover: none) and (pointer: coarse)';

export function isPhoneViewport(
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  width = globalThis.innerWidth,
) {
  let mediaNarrow = false;
  let mediaCoarse = false;
  if (typeof matchMedia === 'function') {
    try {
      mediaNarrow = Boolean(matchMedia(PHONE_MAX_WIDTH_MQ)?.matches);
      mediaCoarse = Boolean(matchMedia(PHONE_COARSE_MQ)?.matches);
    } catch {
      /* ignore */
    }
  }
  const cssNarrow = Number(width) > 0 && Number(width) <= 720;
  return mediaNarrow || mediaCoarse || cssNarrow;
}

/**
 * True when the globe entry should redirect to /ops before Cesium boots.
 * Bypass: ?globe=1 or sessionStorage gev-prefer-globe=1.
 */
export function shouldRoutePhoneToOps({
  search = '',
  sessionStorage = null,
  matchMedia,
  width,
} = {}) {
  const raw =
    typeof search === 'string'
      ? search.startsWith('?')
        ? search.slice(1)
        : search
      : '';
  const params = new URLSearchParams(raw);
  if (params.get('globe') === '1') return false;
  try {
    if (sessionStorage?.getItem?.(PHONE_GLOBE_SESSION_KEY) === '1') return false;
  } catch {
    /* private mode */
  }
  return isPhoneViewport(matchMedia, width);
}

/** Build /ops/?from=globe… preserving lat/lon/z when present. */
export function buildOpsRedirectUrl(locationLike = globalThis.location) {
  const href =
    typeof locationLike === 'string'
      ? locationLike
      : locationLike?.href || 'http://localhost/';
  const src = new URL(href, 'http://localhost');
  const dest = new URL('/ops/', src.origin);
  dest.searchParams.set('from', 'globe');
  const lat = src.searchParams.get('lat');
  const lon =
    src.searchParams.get('lon') ?? src.searchParams.get('lng');
  const z = src.searchParams.get('z') ?? src.searchParams.get('zoom');
  if (lat != null && lat !== '') dest.searchParams.set('lat', lat);
  if (lon != null && lon !== '') dest.searchParams.set('lon', lon);
  if (z != null && z !== '') dest.searchParams.set('z', z);
  return `${dest.pathname}${dest.search}`;
}

export function preferGlobeSession(
  sessionStorage = globalThis.sessionStorage,
) {
  try {
    sessionStorage?.setItem?.(PHONE_GLOBE_SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}
