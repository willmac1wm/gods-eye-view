/**
 * Fire Wire / Cape Dispatch API upstream.
 *
 * Prefer FIREWIRE_URL. CAPE_DISPATCH_URL remains a legacy alias.
 * There is no default host: the old capemaydispatch.com website is retired.
 * Unset means GEV fails closed (proxy 503, Cape CCTV pack empty).
 */

export function resolveCapeUpstream(env = process.env) {
  const raw = String(env.FIREWIRE_URL || env.CAPE_DISPATCH_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return raw;
}

/** True when the configured host is the retired public website (not Fire Wire). */
export function isRetiredCapeWebsite(base) {
  if (!base) return false;
  try {
    const host = new URL(base).hostname.toLowerCase();
    return (
      host === 'capemaydispatch.com' || host.endsWith('.capemaydispatch.com')
    );
  } catch {
    return false;
  }
}
