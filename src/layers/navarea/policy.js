// src/layers/navarea/policy.js
// NGA NAVAREA warnings constants. The bulletins are U.S. federal
// public domain; no key, no registration. The download URL below was
// verified from NGA's own indexed publication record (2026-11-17);
// the key may rotate when NGA republishes — re-verify it from the
// live portal when the site serves again, or override it with the
// NGA_NAVAREA_KEY environment variable (same key= value form).
// BUILD BLOCKER (verified 2026-11-17): msi.nga.mil returns HTTP 503
// (Akamai apology page) for the portal, the home page, and this
// download URL, from BOTH this VM and Legion — the provider cannot
// fetch live bulletins today and degrades to last-good + link-out.
// Do not work around it (no mirrors, no header tricks).
export const NAVAREA_LAYER_ID = 'navarea-warnings';
export const NAVAREA_OVERLAY_SOURCE_ID = 'navarea-warnings';
export const NAVAREA_PORTAL_URL = 'https://msi.nga.mil/NavWarnings';
export const NAVAREA_ATTRIBUTION =
  'NGA Maritime Safety Information (msi.nga.mil) — public domain';
export const NAVAREA_SOLAS_NOTE =
  'Never navigate from this map — check the official bulletin. NGA warnings supplement SOLAS broadcast services.';
export const NAVAREA_DOWNLOAD_KEY = '16694640/SFH00000';
export const NAVAREA_DAILY_FILE = 'DailyMemIV.txt';
export function navareaDownloadUrl(key = NAVAREA_DOWNLOAD_KEY) {
  return (
    'https://msi.nga.mil/api/publications/download' +
    `?key=${key}/${NAVAREA_DAILY_FILE}&type=view`
  );
}
/** Bulletins are rebuilt daily; the provider re-fetches at most daily. */
export const NAVAREA_REFRESH_MS = 24 * 60 * 60 * 1000;
export const NAVAREA_PROXY_TTL_MS = NAVAREA_REFRESH_MS;
export const NAVAREA_PROXY_TIMEOUT_MS = 30_000;
export const NAVAREA_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
