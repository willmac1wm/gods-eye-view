import { normalizeODataProducts } from '../../src/layers/satelliteVerification/records.js';
import {
  COPERNICUS_COUNTY_POINT,
  COPERNICUS_ODATA_BASE_URL,
  COPERNICUS_ODATA_COLLECTION,
  COPERNICUS_ODATA_TOP,
} from '../../src/layers/satelliteVerification/policy.js';
import { readResponseJsonCapped } from './common/http.js';

/**
 * Copernicus Data Space Ecosystem OData proxy (Sentinel-2 discovery).
 *
 * Upstream (keyless, anonymous metadata — verified live 2026-11-17):
 *   GET https://catalogue.dataspace.copernicus.eu/odata/v1/Products
 *     ?$filter=Collection/Name eq 'SENTINEL-2'
 *       and OData.CSC.Intersects(area=geography'SRID=4326;POINT(-74.9 39.0)')
 *     &$orderby=ContentDate/Start desc&$top=10&$select=Id,Name,ContentDate
 *   — newest first (2026-11-15 at verification: S2C L2A/L1C over T18SVJ,
 *   the Cape May tile, plus the neighbouring T18SWJ tile). Metadata search
 *   is anonymous; DOWNLOADS need a free Dataspace account token, which
 *   this proxy never performs — it lists products only (the D7 download
 *   half is scoped down, see LAYER-SPEC-D1-D9.md).
 *
 * The STAC path is NOT used: /v1/collections/SENTINEL-2 and /sentinel-2
 * both 404 (collection ids were renamed); OData is the verified path.
 *
 * The proxy caches the product list for 1 h and serves it stale on
 * upstream failure; the browser never calls the catalogue directly.
 * The GIBS imagery half needs no provider (browser → GIBS, CORS-open).
 *
 * Routes:
 *   GET /api/satellite-verification        → {fetchedAt, stale, ttlMs, products, countyPoint, collection}
 *   GET /api/satellite-verification/status → {lastFetch, stale, ttlMs, productCount}
 *
 * @returns {import('vite').Plugin}
 */

export const COPERNICUS_PROXY_TTL_MS = 60 * 60_000;
export const COPERNICUS_PROXY_TIMEOUT_MS = 15_000;
export const COPERNICUS_PROXY_USER_AGENT =
  'gods-eye-view/1.0 (+https://capemaydispatch.com)';
const COPERNICUS_MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
const COPERNICUS_BACKOFF_MS = 60_000;

export function copernicusProductsUrl() {
  const filter =
    `Collection/Name eq '${COPERNICUS_ODATA_COLLECTION}' and ` +
    `OData.CSC.Intersects(area=geography'SRID=4326;POINT(${COPERNICUS_COUNTY_POINT.lon} ${COPERNICUS_COUNTY_POINT.lat})')`;
  const params = new URLSearchParams({
    $filter: filter,
    $orderby: 'ContentDate/Start desc',
    $top: String(COPERNICUS_ODATA_TOP),
    $select: 'Id,Name,ContentDate',
  });
  return `${COPERNICUS_ODATA_BASE_URL}/Products?${params.toString()}`;
}

export function copernicusProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  warn = (...args) => console.warn(...args),
} = {}) {
  /** @type {?{at: number, products: Array}} */
  let mem = null;
  /** @type {?Promise<?object>} single-flight refresh */
  let inflight = null;
  let backoffUntil = 0;
  let lastFailure = null;

  async function refreshUpstream() {
    const signal = AbortSignal.timeout(COPERNICUS_PROXY_TIMEOUT_MS);
    const res = await fetchImpl(copernicusProductsUrl(), {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': COPERNICUS_PROXY_USER_AGENT,
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const payload = await readResponseJsonCapped(
      res,
      COPERNICUS_MAX_RESPONSE_BYTES,
      signal,
    );
    const products = normalizeODataProducts(payload);
    return { at: now(), products };
  }

  function buildPayload(entry, stale) {
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: COPERNICUS_PROXY_TTL_MS,
      products: entry.products,
      countyPoint: COPERNICUS_COUNTY_POINT,
      collection: COPERNICUS_ODATA_COLLECTION,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/satellite-verification', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];

        if (subPath === '/status') {
          sendJson(200, {
            lastFetch: mem ? mem.at : null,
            stale: mem ? now() - mem.at >= COPERNICUS_PROXY_TTL_MS : false,
            ttlMs: COPERNICUS_PROXY_TTL_MS,
            productCount: mem ? mem.products.length : null,
          });
          return;
        }

        const entry = mem;
        if (entry && now() - entry.at < COPERNICUS_PROXY_TTL_MS) {
          sendJson(200, buildPayload(entry, false));
          return;
        }
        if (now() < backoffUntil) {
          if (entry) {
            sendJson(200, buildPayload(entry, true));
            return;
          }
          sendJson(502, {
            error:
              lastFailure ??
              'Copernicus catalogue failed and no cache available',
          });
          return;
        }
        if (!inflight) {
          inflight = refreshUpstream()
            .then((fresh) => {
              mem = fresh;
              backoffUntil = 0;
              lastFailure = null;
              return mem;
            })
            .catch((err) => {
              backoffUntil = now() + COPERNICUS_BACKOFF_MS;
              lastFailure = null;
              warn(
                `[copernicus-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error:
              lastFailure ??
              'Copernicus catalogue failed and no cache available',
          });
        }
      } catch (err) {
        warn('[copernicus-proxy] error:', err?.message || err);
        sendJson(500, { error: 'copernicus proxy error' });
      }
    });
  };
  return {
    name: 'copernicus-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
