import {
  GIBS_SOURCES,
  SATELLITE_BLACK_TILE_SIZE_BYTES,
  SATELLITE_MAX_LOOKBACK_DAYS,
  SATELLITE_ODATA_ROUTE,
} from './policy.js';
import {
  addDays,
  copernicusBrowserUrl,
  countyTileUrl,
  gibsTileUrlTemplate,
  isValidDateString,
  toDateString,
  worldviewUrl,
} from './records.js';

/**
 * Default black-tile detector. GIBS answers a date with no processed
 * imagery in two ways: HTTP 404 (Aqua/NOAA20) or HTTP 200 with an
 * all-black tile (Terra, verified 2026-11-17: the 2026-11-17 Terra tile
 * is a valid 256×256 JPEG, 1,665 B, every pixel 0 — while 2026-11-16
 * serves a real scene, 5,496 B, mean brightness 58). A 200 alone is
 * therefore not "imagery". In the browser the tile is decoded and
 * downscaled to 8×8; all samples below the threshold means no data.
 * Where no decoder exists (Node/SSR) the byte-size heuristic applies:
 * a black GIBS tile is ~1.6 KB, real county tiles are 5–12 KB.
 * In the browser the catalog injects the decoder from ./blackTile.js;
 * inject `isBlackTile` in tests; never probe with a size guess alone
 * in the browser.
 */
/**
 * The source package must never reach browser globals (boundary rule):
 * the default black-tile test is the pure byte-size heuristic only. The
 * browser-aware decoder lives in ./blackTile.js (layer package only) and
 * is injected by the catalog — the standalone source keeps the heuristic.
 */
export async function defaultIsBlackTile(buffer) {
  const bytes = buffer?.byteLength ?? 0;
  return bytes < SATELLITE_BLACK_TILE_SIZE_BYTES;
}

/**
 * Satellite verification acquisition. The browser fetches GIBS tiles
 * directly (CORS-open, keyless, public domain); the Copernicus OData
 * catalogue is read through the server provider
 * (`/api/satellite-verification`, 1 h TTL, serve-stale) — the browser
 * never calls the catalogue directly.
 *
 * getSnapshot probes the GIBS sources in policy order (Terra → Aqua →
 * NOAA20) for the requested date, stepping back up to 7 days; the first
 * non-black 200 wins. A date served later than requested is reported as
 * `tileStatus: 'nearest'` with both dates on the card — never a
 * neighbouring date's tile presented as the requested date.
 */
export function createSatelliteVerificationSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  isBlackTile = defaultIsBlackTile,
  odataRoute = SATELLITE_ODATA_ROUTE,
  now = () => Date.now(),
} = {}) {
  async function probeTile({ sourceId, date, signal }) {
    signal?.throwIfAborted();
    const res = await fetchImpl(countyTileUrl({ sourceId, date }), {
      signal,
    });
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    return !(await isBlackTile(buffer));
  }

  async function fetchProducts(signal) {
    try {
      const res = await fetchImpl(odataRoute, { signal });
      if (!res.ok) return { available: false, products: [] };
      const payload = await res.json();
      return {
        available: true,
        products: Array.isArray(payload?.products) ? payload.products : [],
      };
    } catch {
      return { available: false, products: [] };
    }
  }

  return {
    credit: 'NASA GIBS · Copernicus Sentinel-2',

    async getSnapshot({ date: requested, signal } = {}) {
      // No date = latest available. A provided-but-invalid date is a
      // caller bug — throw rather than silently showing today.
      if (
        requested !== undefined &&
        requested !== null &&
        !isValidDateString(requested)
      ) {
        throw new TypeError(`Invalid date: ${requested}`);
      }
      const requestedDate = requested ?? toDateString(new Date(now()));
      let served = null;
      for (
        let offset = 0;
        offset <= SATELLITE_MAX_LOOKBACK_DAYS && !served;
        offset += 1
      ) {
        const candidate = addDays(requestedDate, -offset);
        for (const source of GIBS_SOURCES) {
          signal?.throwIfAborted();
          if (
            await probeTile({ sourceId: source.id, date: candidate, signal })
          ) {
            served = { source: source.id, date: candidate, offset };
            break;
          }
        }
      }
      const catalogue = await fetchProducts(signal);
      const tileStatus = !served
        ? 'none'
        : served.offset === 0
          ? 'live'
          : 'nearest';
      return {
        requestedDate,
        date: served?.date ?? null,
        source: served?.source ?? null,
        tileUrl: served
          ? countyTileUrl({ sourceId: served.source, date: served.date })
          : null,
        tileUrlTemplate: served
          ? gibsTileUrlTemplate({ sourceId: served.source, date: served.date })
          : null,
        tileStatus,
        products: catalogue.products,
        catalogueAvailable: catalogue.available,
        worldviewUrl: worldviewUrl(served?.date ?? requestedDate),
        copernicusBrowserUrl: copernicusBrowserUrl(
          served?.date ?? requestedDate,
        ),
        fetchedAt: now(),
      };
    },
  };
}
