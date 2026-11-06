/**
 * NJ DCA Construction Permit Data (Socrata w9se-dmra) for Cape May County.
 * Public domain — Codes & Standards. No owner names, no lat/lon in the feed;
 * join to Place parcel compile by comu/block/lot when known.
 */
import { readResponseJsonCapped } from '../common/http.js';
import { requiredFiniteQueryNumber } from '../common/query.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';

export const DCA_PERMITS_URL = 'https://data.nj.gov/resource/w9se-dmra.json';
const MIB = 1024 * 1024;
const CACHE_TTL_MS = 15 * 60_000;

/** Municipality display name (upper) → NJ treasury/comu code for Cape May. */
export const CAPE_MAY_COMU = Object.freeze({
  AVALON: '0501',
  'CAPE MAY': '0502',
  'CAPE MAY POINT': '0503',
  DENNIS: '0504',
  'LOWER TOWNSHIP': '0505',
  'MIDDLE TOWNSHIP': '0506',
  'NORTH WILDWOOD': '0507',
  OCEAN: '0508',
  'OCEAN CITY': '0509',
  'SEA ISLE CITY': '0510',
  'STONE HARBOR': '0511',
  'UPPER TOWNSHIP': '0512',
  'WEST CAPE MAY': '0513',
  'WEST WILDWOOD': '0514',
  WILDWOOD: '0515',
  'WILDWOOD CREST': '0516',
  WOODBINE: '0517',
});

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** Map Place municipality / COMU to a 4-digit treasury code when possible. */
export function resolveCapeComu({ comu, municipality } = {}) {
  const direct = String(comu || '')
    .trim()
    .replace(/\D/g, '');
  if (/^05\d{2}$/.test(direct)) return direct;
  const name = normalizeToken(municipality)
    .replace(/\b(CITY|BOROUGH|BORO|TOWNSHIP|TWP)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (CAPE_MAY_COMU[name]) return CAPE_MAY_COMU[name];
  // "Lower Twp" / "Cape May City" variants already stripped; try startsWith.
  for (const [key, code] of Object.entries(CAPE_MAY_COMU)) {
    if (name.startsWith(key) || key.startsWith(name)) return code;
  }
  return null;
}

/**
 * Map one Socrata row into Place desk case shape. No owners.
 * @param {Record<string, unknown>} row
 */
export function mapDcaPermitRow(row) {
  if (!row || typeof row !== 'object') return null;
  const permitno = String(row.permitno || '').trim();
  const block = String(row.block || '').trim();
  const lot = String(row.lot || '').trim();
  const muniname = String(row.muniname || '').trim();
  const type = String(row.permittypedesc || row.permittype || 'Permit').trim();
  const status = String(row.permitstatusdesc || row.status || '').trim();
  const opened = String(row.permitdate || '').slice(0, 10) || null;
  const id =
    String(row.pk || '').trim() ||
    [row.comu, permitno, block, lot].filter(Boolean).join('-') ||
    null;
  if (!id && !permitno) return null;
  return {
    id: id || permitno,
    title: type,
    type: 'permit',
    status: status || null,
    address: [block && `Block ${block}`, lot && `Lot ${lot}`, muniname]
      .filter(Boolean)
      .join(' · '),
    opened_at: opened,
    block: block || null,
    lot: lot || null,
    comu: String(row.comu || '').trim() || null,
    municipality: muniname || null,
    permitno: permitno || null,
    constcost: row.constcost != null ? Number(row.constcost) : null,
    source: 'nj-dca-w9se-dmra',
    attribution: 'NJ DCA Construction Permit Data (public domain)',
  };
}

function socrataWhere({ county, comu, block, lot }) {
  const parts = [];
  if (comu) parts.push(`comu='${String(comu).replace(/'/g, "''")}'`);
  else if (county) parts.push(`county='${String(county).replace(/'/g, "''")}'`);
  if (block) parts.push(`block='${String(block).replace(/'/g, "''")}'`);
  if (lot) parts.push(`lot='${String(lot).replace(/'/g, "''")}'`);
  return parts.join(' AND ');
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {() => number} [options.now]
 */
export function createPermitsNativeHandler({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 400 });
  const cache = new Map();

  async function queryDca(params) {
    const where = socrataWhere(params);
    const qs = new URLSearchParams({
      $limit: String(Math.min(100, Math.max(1, params.limit || 40))),
      $order: 'permitdate DESC',
    });
    if (where) qs.set('$where', where);
    const url = `${DCA_PERMITS_URL}?${qs}`;
    const signal = AbortSignal.timeout(20_000);
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new Error(`dca_http_${response.status}`);
    }
    const rows = await readResponseJsonCapped(response, 4 * MIB, signal);
    if (!Array.isArray(rows)) throw new Error('dca_bad_payload');
    return rows.map(mapDcaPermitRow).filter(Boolean);
  }

  return async function permitsHandler(req, res) {
    if (!admitSameSiteKeyless(req, res)) return;
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
    const comuParam = url.searchParams.get('comu');
    const block = url.searchParams.get('block');
    const lot = url.searchParams.get('lot');
    const municipality = url.searchParams.get('municipality');
    const county = url.searchParams.get('county') || 'CAPE MAY';
    const limit = Number(url.searchParams.get('limit')) || 40;

    // Point queries without parcel keys fall back to recent county-wide list
    // (honest: no invented geocode). Callers with Place parcel pass block/lot.
    const comu = resolveCapeComu({ comu: comuParam, municipality });
    const cacheKey = [
      comu || county,
      block || '',
      lot || '',
      String(limit),
      lat != null ? lat.toFixed(4) : '',
      lon != null ? lon.toFixed(4) : '',
    ].join('|');
    const t = now();
    const hit = cache.get(cacheKey);
    if (hit && hit.exp > t) {
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, hit.body);
    }

    try {
      const permits = await queryDca({
        county: comu ? null : county,
        comu,
        block: block || null,
        lot: lot || null,
        limit,
      });
      const body = {
        permits,
        count: permits.length,
        source: 'nj-dca-w9se-dmra',
        attribution: 'NJ DCA Construction Permit Data (public domain)',
        filter: { county, comu, block, lot, lat, lon },
        note:
          block || lot || comu
            ? 'Filtered by parcel / municipality keys when provided.'
            : 'Recent Cape May County permits (no street geocode in DCA feed).',
      };
      cache.set(cacheKey, { exp: t + CACHE_TTL_MS, body });
      if (req.method === 'HEAD') {
        res.statusCode = 200;
        return res.end();
      }
      return json(res, 200, body);
    } catch (error) {
      return json(res, 502, {
        error: 'permits_unavailable',
        detail: String(error?.message || error),
      });
    }
  };
}
