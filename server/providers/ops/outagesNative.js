/**
 * Native power outage snapshot for Cape May / Atlantic / Cumberland.
 * Tries public utility ArcGIS layers; returns honest empty on failure.
 */

import { admitSameSiteKeyless } from '../common/same-site.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';

/** County rollup keys expected by mapOutages / board. */
const COUNTIES = Object.freeze(['Cape May', 'Atlantic', 'Cumberland']);

/**
 * ACE / FirstEnergy-style public outage summary endpoints vary; we query a
 * known ArcGIS FeatureServer pattern and soft-fail to zeros.
 */
const OUTAGE_QUERIES = Object.freeze([
  // Atlantic City Electric county summary (public when published).
  'https://services1.arcgis.com/4yjifSiIG17na0WA/arcgis/rest/services/Power_Outages_Public/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json',
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(JSON.stringify(body));
}

function emptyPayload(source = 'native-empty') {
  const counties = {};
  for (const name of COUNTIES) counties[name] = { out: 0, served: 0 };
  return {
    counties,
    customers_affected: 0,
    updated_at: null,
    source,
  };
}

function countyFromAttrs(attrs) {
  const raw = String(
    attrs?.COUNTY ||
      attrs?.county ||
      attrs?.County ||
      attrs?.COUNTY_NAME ||
      attrs?.NAME ||
      '',
  ).trim();
  for (const name of COUNTIES) {
    if (raw.toLowerCase().includes(name.toLowerCase().split(' ')[0])) {
      return name;
    }
  }
  return null;
}

function customersFromAttrs(attrs) {
  const n = Number(
    attrs?.CUSTOMERS ||
      attrs?.customers ||
      attrs?.CustomersOut ||
      attrs?.CUST_OUT ||
      attrs?.outages ||
      0,
  );
  return Number.isFinite(n) ? n : 0;
}

export async function fetchNativeOutages({
  fetchImpl = globalThis.fetch.bind(globalThis),
  now = () => Date.now(),
} = {}) {
  for (const url of OUTAGE_QUERIES) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) continue;
      const data = await response.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      if (!features.length) continue;
      const counties = emptyPayload().counties;
      let total = 0;
      for (const f of features) {
        const attrs = f.attributes || f.properties || {};
        const county = countyFromAttrs(attrs);
        const n = customersFromAttrs(attrs);
        if (county) {
          const prev = counties[county] || { out: 0, served: 0 };
          counties[county] = {
            out: (prev.out || 0) + n,
            served: prev.served || 0,
          };
          total += n;
        }
      }
      return {
        counties,
        customers_affected: total,
        updated_at: new Date(now()).toISOString(),
        source: 'native-arcgis',
      };
    } catch {
      /* try next */
    }
  }
  return emptyPayload('native-unconfigured');
}

export function createOutagesNativeHandler(options = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 300 });
  let cache = null;
  let cacheAt = 0;

  return async function outagesHandler(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      json(res, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!allow(clientKey(req))) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }
    try {
      if (!cache || Date.now() - cacheAt > 60_000) {
        cache = await fetchNativeOutages(options);
        cacheAt = Date.now();
      }
      json(res, 200, cache);
    } catch (error) {
      json(res, 502, {
        error: 'native_outages_failed',
        detail: String(error?.message || error),
      });
    }
  };
}
