/**
 * Rewrite Fire Wire audio URLs onto the same-origin Cape proxy.
 * Broadcastify is not used. Clips come from Fire Wire (SDR ingest later).
 */

export function rewriteCapeAudioUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('/api/cape/')) return value;
  if (value.startsWith('/audio/')) return `/api/cape${value}`;
  if (value.startsWith('/fw-audio/')) return `/api/cape${value}`;
  if (value.startsWith('/api/audio/'))
    return value.replace(/^\/api\//, '/api/cape/');
  if (value.startsWith('/api/fw-audio/'))
    return value.replace(/^\/api\//, '/api/cape/');
  if (!/^https?:\/\//i.test(value)) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const path = url.pathname || '';
  if (path.startsWith('/audio/') || path.startsWith('/fw-audio/')) {
    return `/api/cape${path}${url.search || ''}`;
  }
  if (path.startsWith('/api/audio/') || path.startsWith('/api/fw-audio/')) {
    return `/api/cape${path.slice(4)}${url.search || ''}`;
  }
  // Unknown absolute host: refuse so we never play Broadcastify or third-party
  // streams outside the Fire Wire proxy contract.
  return '';
}
