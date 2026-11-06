import {
  readResponseJsonCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

const PARCEL_QUERY =
  'https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0/query';

const OUT_FIELDS = [
  'PROP_LOC',
  'PROP_CLASS',
  'BLDG_DESC',
  'YR_CONSTR',
  'LAND_DESC',
  'MUN_NAME',
  'COUNTY',
  'CALC_ACRE',
  'NET_VALUE',
  'DWELL',
  'COMM_DWELL',
  'BLDG_CLASS',
  'PROP_USE',
  'PAMS_PIN',
  'PCLBLOCK',
  'PCLLOT',
].join(',');

/** NJ MOD-IV property class → occupancy label. Never expose OWNER_NAME. */
const PROP_CLASS_LABEL = {
  1: 'Vacant land',
  2: 'Residential',
  '3A': 'Farm (regular)',
  '3B': 'Farm (qualified)',
  '4A': 'Commercial',
  '4B': 'Industrial',
  '4C': 'Apartment',
  '15A': 'Public school',
  '15B': 'Other school',
  '15C': 'Public property',
  '15D': 'Church / charitable',
  '15E': 'Cemeteries / graveyards',
  '15F': 'Other exempt',
};

const MIB = 1024 * 1024;
const CACHE_TTL_MS = 10 * 60_000;
const STALE_MAX_MS = 6 * 60 * 60_000;

function occupancyFrom(attrs) {
  const code = String(attrs.PROP_CLASS || '').trim();
  return {
    code: code || null,
    label: PROP_CLASS_LABEL[code] || (code ? `Class ${code}` : null),
    use: attrs.PROP_USE || null,
    dwellings: attrs.DWELL ?? null,
    commercialUnits: attrs.COMM_DWELL ?? null,
  };
}

function constructionFrom(attrs) {
  const building = attrs.BLDG_DESC || null;
  const land = attrs.LAND_DESC || null;
  return {
    yearBuilt: attrs.YR_CONSTR ?? null,
    building,
    land,
    buildingClass: attrs.BLDG_CLASS || null,
    materialsNote: [building, land].filter(Boolean).join(' · ') || null,
  };
}

function parcelFrom(attrs) {
  const block = attrs.PCLBLOCK || '';
  const lot = attrs.PCLLOT || '';
  return {
    address: attrs.PROP_LOC || null,
    municipality: attrs.MUN_NAME || null,
    county: attrs.COUNTY || null,
    blockLot: block || lot ? `${block} / ${lot}`.trim() : null,
    pin: attrs.PAMS_PIN || null,
    acres: attrs.CALC_ACRE ?? null,
    assessedNet: attrs.NET_VALUE ?? null,
    propClass: attrs.PROP_CLASS || null,
  };
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function createPlaceHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });

  async function upstream(lat, lon) {
    const url =
      `${PARCEL_QUERY}?` +
      new URLSearchParams({
        geometry: `${lon},${lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: OUT_FIELDS,
        returnGeometry: 'false',
        f: 'json',
      }).toString();
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error('parcel_upstream_unavailable');
    }
    const payload = await readResponseJsonCapped(response, 2 * MIB, signal);
    const feature = payload?.features?.[0];
    const attrs = feature?.attributes || null;
    if (!attrs) {
      return {
        lat,
        lon,
        parcel: null,
        occupancy: null,
        construction: null,
        source: 'njogis-cadastral',
        found: false,
      };
    }
    return {
      lat,
      lon,
      parcel: parcelFrom(attrs),
      occupancy: occupancyFrom(attrs),
      construction: constructionFrom(attrs),
      source: 'njogis-cadastral',
      found: true,
      // Explicit: owner / mailing identity never leaves the proxy.
      privacy: { ownerName: 'redacted', mailingAddress: 'redacted' },
    };
  }

  return async function placeHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end();
    }
    if (!allow(clientKey(req))) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const url = new URL(req.url || '/', 'http://local');
    const lat = requiredFiniteQueryNumber(url.searchParams, 'lat');
    const lon = requiredFiniteQueryNumber(url.searchParams, 'lon');
    if (
      lat == null ||
      lon == null ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      return json(res, 400, { error: 'lat_lon_required' });
    }
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.exp > t) {
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, hit.body);
    }

    try {
      const { promise } = coalesceProxyRequest(inFlight, key, () =>
        upstream(lat, lon),
      );
      const body = await promise;
      cache.set(key, { exp: t + CACHE_TTL_MS, body, at: t });
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, body);
    } catch (error) {
      if (hit && t - hit.at < STALE_MAX_MS) {
        return json(res, 200, { ...hit.body, stale: true });
      }
      return json(res, 502, {
        error: 'place_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
