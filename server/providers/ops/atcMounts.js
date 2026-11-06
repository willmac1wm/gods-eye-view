/**
 * Allowlisted LiveATC Icecast mounts (old Cape Dispatch / Fire Wire catalog).
 * Managers may enable/disable mounts; arbitrary URLs are refused.
 */

export const LIVEATC_ICECAST_HOSTS = Object.freeze([
  'd.liveatc.net',
  's1-fmt.liveatc.net',
  's1-bos.liveatc.net',
  's1-fmt2.liveatc.net',
]);

/** Default Cape / South Jersey ATC mounts. */
export const DEFAULT_ATC_MOUNTS = Object.freeze([
  Object.freeze({
    id: 'kacy_a_twr',
    icao: 'KACY',
    label: 'Atlantic City Tower / Approach',
    mount: 'kacy_a_twr',
    enabled: true,
  }),
  Object.freeze({
    id: 'kwwd_twr',
    icao: 'KWWD',
    label: 'Cape May County Tower',
    mount: 'kwwd_twr',
    enabled: true,
  }),
  Object.freeze({
    id: 'kmiv_awos',
    icao: 'KMIV',
    label: 'Millville AWOS / CTAF',
    mount: 'kmiv_awos',
    enabled: false,
  }),
]);

export function iceCastUrlForMount(mountId, host = 'd.liveatc.net') {
  const mount = String(mountId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  if (!mount) return null;
  const safeHost = LIVEATC_ICECAST_HOSTS.includes(host)
    ? host
    : LIVEATC_ICECAST_HOSTS[0];
  return `http://${safeHost}/${mount}`;
}

export function findMount(mountId, catalog = DEFAULT_ATC_MOUNTS) {
  const id = String(mountId || '')
    .trim()
    .toLowerCase();
  if (!id) return null;
  return (
    catalog.find((m) => m.id === id || m.mount === id) ||
    DEFAULT_ATC_MOUNTS.find((m) => m.id === id || m.mount === id) ||
    null
  );
}

export function resolveAllowedStreamUrl(mountId, catalog = DEFAULT_ATC_MOUNTS) {
  const entry = findMount(mountId, catalog);
  if (!entry || entry.enabled === false) return null;
  return iceCastUrlForMount(entry.mount);
}

/** Rewrite audio paths onto same-origin ATC proxy. */
export function rewriteAtcAudioUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('/api/ops/atc/')) return value;
  if (value.startsWith('/ops/atc/stream')) return `/api${value}`;
  try {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (LIVEATC_ICECAST_HOSTS.includes(url.hostname)) {
        const mount = url.pathname.replace(/^\//, '');
        if (findMount(mount)) {
          return `/api/ops/atc/stream?mount=${encodeURIComponent(mount)}`;
        }
      }
      return '';
    }
  } catch {
    return '';
  }
  if (findMount(value)) {
    return `/api/ops/atc/stream?mount=${encodeURIComponent(value)}`;
  }
  return '';
}
