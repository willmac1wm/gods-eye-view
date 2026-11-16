// FAA Temporary Flight Restrictions for the cape-tfrs layer — live
// ingestion + GeoJSON engine. Port of the old app's app/tfrs.py (same
// sources, same AIXM parsing, same payload shape).
//
//   - List:  https://tfr.faa.gov/tfrapi/getTfrList
//   - Detail per TFR: https://tfr.faa.gov/download/detail_{id}.xml
//     (AIXM XML boundary polygons; NOTAM id "6/4120" becomes "6_4120")
//
// Priority first (Mid-Atlantic facilities + VIP nationwide + Security),
// then the first 30 of the rest, so one refresh never floods the FAA
// server. Detail fetches run 8 at a time.
import {
  readResponseJsonCapped,
  readResponseTextCapped,
} from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';

const TFR_LIST_URL = 'https://tfr.faa.gov/tfrapi/getTfrList';
const TFR_DETAIL_URL = (cleanId) =>
  `https://tfr.faa.gov/download/detail_${cleanId}.xml`;
const TFR_PAGE_URL = (cleanId) =>
  `https://tfr.faa.gov/save_pages/detail_${cleanId}.html`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CapeDispatch/2.0';

export const PRIORITY_FACILITIES = Object.freeze(
  new Set(['ZNY', 'ZDC', 'ZBW', 'ZOB', 'ZJX']),
);
export const PRIORITY_STATES = Object.freeze(
  new Set(['NJ', 'DE', 'PA', 'MD', 'NY', 'VA', 'DC', 'NC']),
);
const SECONDARY_LIMIT = 30;
const DETAIL_CONCURRENCY = 8;

const CACHE_MS = 300_000; // 5 minutes, like the old daemon
const MAX_LIST_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

const COORD_PATTERN =
  /<geoLat>([0-9.]+)([NS])<\/geoLat>\s*<geoLong>([0-9.]+)([EW])<\/geoLong>/g;

/** Converts NOTAM ID like '6/4120' into '6_4120' for FAA detail XML URL. */
export function cleanNotamId(notamId) {
  return String(notamId || '')
    .replace(/\//g, '_')
    .trim();
}

function firstGroup(xml, pattern) {
  const match = pattern.exec(xml);
  return match ? match[1] : null;
}

/** Parses FAA AIXM XML into GeoJSON Feature polygons. */
export function parseAixmXmlToFeatures(rawXml, meta = {}) {
  const features = [];
  const notamId = meta.notam_id || 'Unknown';
  const tfrType = meta.type || 'TFR';
  const desc = meta.description || '';
  const facility = meta.facility || '';
  const state = meta.state || '';

  const eff = firstGroup(rawXml, /<dateEffective>([^<]+)<\/dateEffective>/);
  const exp = firstGroup(rawXml, /<dateExpire>([^<]+)<\/dateExpire>/);

  // Split into TFRAreaGroup segments (e.g. inner vs outer rings).
  let areaGroups = String(rawXml || '').split('<TFRAreaGroup>');
  if (areaGroups.length <= 1) areaGroups = ['', rawXml];

  areaGroups.slice(1).forEach((group, groupIndex) => {
    const idx = groupIndex + 1;
    const upper = firstGroup(
      group,
      /<valDistVerUpper>([0-9]+)<\/valDistVerUpper>/,
    );
    const lower = firstGroup(
      group,
      /<valDistVerLower>([0-9]+)<\/valDistVerLower>/,
    );
    const upperUom = firstGroup(
      group,
      /<uomDistVerUpper>([^<]+)<\/uomDistVerUpper>/,
    );
    const lowerUom = firstGroup(
      group,
      /<uomDistVerLower>([^<]+)<\/uomDistVerLower>/,
    );
    const name = firstGroup(group, /<txtName>([^<]+)<\/txtName>/);
    const altHigh = upper != null ? Number(upper) : 18000;
    const altLow = lower != null ? Number(lower) : 0;
    const uomHigh = upperUom || 'FT';
    const uomLow = lowerUom || 'FT';
    const areaName = name || `Ring ${idx}`;

    const coords = [];
    COORD_PATTERN.lastIndex = 0;
    let match;
    while ((match = COORD_PATTERN.exec(group)) !== null) {
      const lat = Number(match[1]) * (match[2] === 'N' ? 1 : -1);
      const lon = Number(match[3]) * (match[4] === 'W' ? -1 : 1);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        coords.push([Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
      }
    }
    if (coords.length < 3) return;
    // Ensure closed linear ring.
    if (
      coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1]
    ) {
      coords.push(coords[0]);
    }
    features.push({
      type: 'Feature',
      id: `tfr_${cleanNotamId(notamId)}_${idx}`,
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: {
        notam_id: notamId,
        type: tfrType,
        area_name: areaName,
        facility,
        state,
        description: desc,
        alt_low: altLow,
        alt_high: altHigh,
        alt_low_str: `${altLow} ${uomLow}`,
        alt_high_str: `${altHigh} ${uomHigh}`,
        effective: eff || '',
        expire: exp || '',
        is_vip: tfrType === 'VIP',
        is_security: tfrType === 'SECURITY',
        is_regional:
          PRIORITY_FACILITIES.has(facility) || PRIORITY_STATES.has(state),
        source: 'FAA AIS',
        faa_url: TFR_PAGE_URL(cleanNotamId(notamId)),
      },
    });
  });
  return features;
}

/** Priority (Mid-Atlantic + VIP nationwide + Security) first, then 30 more. */
export function selectTfrItems(list) {
  const priority = [];
  const secondary = [];
  for (const item of list || []) {
    const fac = item?.facility || '';
    const st = item?.state || '';
    const typ = item?.type || '';
    if (
      PRIORITY_FACILITIES.has(fac) ||
      PRIORITY_STATES.has(st) ||
      typ === 'VIP' ||
      typ === 'SECURITY'
    ) {
      priority.push(item);
    } else {
      secondary.push(item);
    }
  }
  return [...priority, ...secondary.slice(0, SECONDARY_LIMIT)];
}

async function fetchTfrDetail(fetchImpl, item) {
  const notamId = item?.notam_id || '';
  if (!notamId) return [];
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetchImpl(TFR_DETAIL_URL(cleanNotamId(notamId)), {
      signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) return [];
    const { tooLarge, text } = await readResponseTextCapped(
      response,
      MAX_DETAIL_BYTES,
      signal,
    );
    if (tooLarge) return [];
    return parseAixmXmlToFeatures(text, item);
  } catch {
    return [];
  }
}

export function tfrsProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load() {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await fetchImpl(TFR_LIST_URL, {
      signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`tfr_upstream_${response.status}`);
    const list = await readResponseJsonCapped(response, MAX_LIST_BYTES, signal);
    if (!Array.isArray(list)) throw new Error('tfr_list_not_array');
    const selected = selectTfrItems(list);
    const features = [];
    for (let i = 0; i < selected.length; i += DETAIL_CONCURRENCY) {
      const batch = selected.slice(i, i + DETAIL_CONCURRENCY);
      const results = await Promise.all(
        batch.map((item) => fetchTfrDetail(fetchImpl, item)),
      );
      for (const result of results) features.push(...result);
    }
    const at = now();
    return {
      type: 'FeatureCollection',
      features,
      updated_at: Math.floor(at / 1000),
      updated_iso: new Date(at).toISOString(),
      count: features.length,
    };
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) return json(200, cache);
    try {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, cache);
    } catch (error) {
      if (cache) return json(200, { ...cache, stale: true });
      return json(502, {
        error: 'tfr_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'faa-tfrs',
    configureServer({ middlewares }) {
      middlewares.use('/api/tfrs', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/tfrs', handler);
    },
  };
}
