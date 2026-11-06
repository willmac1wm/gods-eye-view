/**
 * LiveATC external link-outs only — never proxy or restream (ToS/licensing).
 * Used by /ops/aviation (and scanners cross-links).
 */

export const LIVEATC_AIRPORTS = Object.freeze([
  Object.freeze({
    icao: 'KWWD',
    name: 'Cape May County (Wildwood)',
    searchUrl: 'https://www.liveatc.net/search/?icao=KWWD',
    airportUrl: 'https://www.liveatc.net/airports/?icao=KWWD',
  }),
  Object.freeze({
    icao: 'KACY',
    name: 'Atlantic City Intl',
    searchUrl: 'https://www.liveatc.net/search/?icao=KACY',
    airportUrl: 'https://www.liveatc.net/airports/?icao=KACY',
  }),
  Object.freeze({
    icao: 'KMIV',
    name: 'Millville Municipal',
    searchUrl: 'https://www.liveatc.net/search/?icao=KMIV',
    airportUrl: 'https://www.liveatc.net/airports/?icao=KMIV',
  }),
]);

export function liveatcLinksEnabled(config) {
  if (config?.sources?.liveatc?.links === false) return false;
  return true;
}

export function liveatcListHtml(esc) {
  return LIVEATC_AIRPORTS.map((apt) => {
    return (
      `<b>${esc(apt.icao)}</b> ${esc(apt.name)} — ` +
      `<a href="${apt.searchUrl}" target="_blank" rel="noopener noreferrer">LiveATC search</a>` +
      ` · <a href="${apt.airportUrl}" target="_blank" rel="noopener noreferrer">airport page</a>` +
      ` <span class="ops-note">(external · no in-app audio)</span>`
    );
  });
}
