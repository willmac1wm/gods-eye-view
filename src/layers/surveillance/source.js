import { OVERPASS_URL, QUERY_LIMIT, MAX_VIEWPORT_DEGREES } from './policy.js';
import {
  buildOverpassQuery,
  normalizeSurveillanceElement,
  validateSurveillanceSnapshot,
} from './records.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Mirrors the ALPR Overpass source — the proxy owns the upstream call,
 * the cache and the backoff; this client only validates what comes back.
 * The Overpass API is keyless; the proxy is the shipped path so repeat
 * views hit the server cache instead of the public instances.
 *
 * Locations only: this source reads OSM `man_made=surveillance` tags. It
 * never fetches frames, streams, plate reads or any live camera data.
 * Attribution (baked into the layer panel): "© OpenStreetMap contributors,
 * ODbL". Data is community mapped — an incomplete floor, never a total.
 */
export function createSurveillanceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function fetchCameras(box, { signal } = {}) {
    signal?.throwIfAborted();
    if (
      !box ||
      ![box.south, box.west, box.north, box.east].every(Number.isFinite) ||
      box.south < -90 ||
      box.north > 90 ||
      box.west < -180 ||
      box.east > 180 ||
      box.north <= box.south ||
      box.east <= box.west ||
      box.north - box.south > MAX_VIEWPORT_DEGREES + 1e-9 ||
      box.east - box.west > MAX_VIEWPORT_DEGREES + 1e-9
    ) {
      throw new TypeError(
        'Surveillance cameras require a bounded city viewport',
      );
    }
    const query = buildOverpassQuery(box.south, box.west, box.north, box.east);
    const response = await fetchImpl(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        /* already closed */
      }
      const message =
        response.status === 429
          ? 'Overpass rate-limited'
          : response.status === 504
            ? 'Overpass timed out'
            : 'Overpass temporarily unavailable';
      throw new Error(message);
    }
    const stale = response.headers.get('x-overpass-cache') === 'STALE';
    const payload = await response.json();
    signal?.throwIfAborted();
    // The shared proxy already rejects query errors. Validate here too so a
    // malformed or partial response never becomes an authoritative empty map.
    if (!Array.isArray(payload?.elements) || payload.remark) {
      throw new Error(msg('Overpass returned an incomplete camera response'));
    }
    const snapshot = {
      records: [
        ...new Map(
          payload.elements
            .slice(0, QUERY_LIMIT)
            .map(normalizeSurveillanceElement)
            .filter(Boolean)
            .map((record) => [record.id, record]),
        ).values(),
      ],
      stale,
      saturated: payload.elements.length >= QUERY_LIMIT,
    };
    validateSurveillanceSnapshot(snapshot);
    return {
      ...snapshot,
      // The query covers only the requested box; reuse only the box.
      coverage: { ...box },
    };
  }
  return {
    fetch: fetchCameras,
    label: msg('OpenStreetMap · community mapped'),
    attribution: {
      name: 'OpenStreetMap',
      description: 'OpenStreetMap contributors (ODbL 1.0; community mapped)',
      text: '© OpenStreetMap contributors',
      href: 'https://www.openstreetmap.org/copyright',
    },
  };
}

export { buildOverpassQuery } from './records.js';
