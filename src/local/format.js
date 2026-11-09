/**
 * Shared wording for the local-awareness features. Every time is shown in
 * Eastern time with its age, and every item carries a status badge whose
 * meaning never changes between layers:
 *
 *   LIVE         feed fetched recently and the item is current
 *   DELAYED      last good copy kept because the feed failed or is late
 *   OFFICIAL     issued by a government agency (NWS alerts)
 *   OBSERVED     a measured reading
 *   FORECAST     an agency forecast (not yet happened)
 *   ESTIMATE     modelled / derived — never a measurement
 *   REPORTED     reported by a third party (utility, TomTom, scanner)
 *   TRANSCRIBED  machine transcript of radio audio
 *   UNVERIFIED   community or unconfirmed information
 *   REFERENCE    static reference data (facility locations, boundaries)
 *   NOT REPORTING / UNAVAILABLE
 */
const TZ = 'America/New_York';

export const STATUS_STYLE = Object.freeze({
  live: { text: 'LIVE', tone: 'ok' },
  delayed: { text: 'DELAYED', tone: 'warn' },
  official: { text: 'OFFICIAL', tone: 'info' },
  observed: { text: 'OBSERVED', tone: 'ok' },
  forecast: { text: 'FORECAST', tone: 'info' },
  estimated: { text: 'ESTIMATE', tone: 'warn' },
  'no-flood-forecast': { text: 'NO FLOOD FORECAST', tone: 'muted' },
  reported: { text: 'REPORTED', tone: 'info' },
  transcribed: { text: 'TRANSCRIBED', tone: 'info' },
  unverified: { text: 'UNVERIFIED', tone: 'warn' },
  verified: { text: 'VERIFIED', tone: 'ok' },
  reference: { text: 'REFERENCE', tone: 'muted' },
  regulatory: { text: 'REGULATORY', tone: 'info' },
  'not-reporting': { text: 'NOT REPORTING', tone: 'muted' },
  unavailable: { text: 'UNAVAILABLE', tone: 'bad' },
  simulated: { text: 'SIMULATED', tone: 'warn' },
});

export function statusBadge(status) {
  return STATUS_STYLE[status] || { text: String(status || 'UNKNOWN').toUpperCase(), tone: 'muted' };
}

export function relativeTime(iso, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const diff = now - t;
  const future = diff < 0;
  const m = Math.round(Math.abs(diff) / 60000);
  let text;
  if (m < 1) text = 'now';
  else if (m < 60) text = `${m} min`;
  else if (m < 48 * 60) text = `${Math.round(m / 60)} h`;
  else text = `${Math.round(m / 1440)} d`;
  if (text === 'now') return future ? 'in a moment' : 'just now';
  return future ? `in ${text}` : `${text} ago`;
}

export function easternTime(iso, { date = true } = {}) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: date ? 'short' : undefined,
    day: date ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(t));
}

/** "Nov 9, 2:15 PM EST · 12 min ago" */
export function whenText(iso) {
  const abs = easternTime(iso);
  const rel = relativeTime(iso);
  return abs ? `${abs}${rel ? ` · ${rel}` : ''}` : null;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function distanceKm(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r;
  const dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
