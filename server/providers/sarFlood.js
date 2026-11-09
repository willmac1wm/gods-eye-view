/**
 * Sentinel-1 radar flood map for Cape May County (Copernicus Data Space).
 *
 *   GET /api/sar-flood/status        → { configured, available, latestPass, ... }
 *   GET /api/sar-flood/new-water.png → RGBA overlay of the county bbox
 *
 * Radar sees through cloud and darkness; calm water is a mirror to it and
 * returns dark (VV below about -18 dB). "New water" is water in the newest
 * pass that was dry in each of the previous passes at that pixel, which drops
 * the ocean, the bay and normal tidal marsh and leaves what is unusual.
 *
 * Ported from Cape Dispatch, but done in ONE Sentinel Hub request: the
 * evalscript sees every pass in the window (ORBIT mosaicking) and Sentinel
 * Hub's Lee speckle filter replaces the old local median filter. Only real
 * radar results are served — there is no synthetic fallback image.
 *
 * Needs CDSE_CLIENT_ID / CDSE_CLIENT_SECRET (a Copernicus Data Space OAuth
 * client). The catalog is checked every 6 h; the image is re-rendered only
 * when a new pass lands (every ~5-12 days), so Processing Unit use is small.
 */

const TOKEN_URL =
  'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search';
const PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

export const SAR_FLOOD_BBOX = Object.freeze([-75.1, 38.9, -74.55, 39.35]); // W,S,E,N
const WIDTH = 1400;
const HEIGHT = 1500;
const LOOKBACK_DAYS = 75;
const BASELINE_PASSES = 4;
const CHECK_MS = 6 * 3600 * 1000;

export const SAR_FLOOD_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["VV", "dataMask"] }],
    output: { bands: 4, sampleType: "UINT8" },
    mosaicking: "ORBIT"
  };
}
function preProcessScenes(collections) {
  collections.scenes.orbits.sort(function (a, b) {
    return new Date(b.dateFrom) - new Date(a.dateFrom);
  });
  return collections;
}
function wet(s) { return 10 * Math.log(s.VV) / Math.LN10 < -18; }
function valid(s) { return s.dataMask === 1 && s.VV > 0; }
function evaluatePixel(samples) {
  if (!samples.length || !valid(samples[0]) || !wet(samples[0])) return [0, 0, 0, 0];
  var seen = 0;
  for (var i = 1; i < samples.length && seen < ${BASELINE_PASSES}; i++) {
    if (!valid(samples[i])) continue;
    seen++;
    if (wet(samples[i])) return [0, 0, 0, 0];
  }
  if (seen === 0) return [0, 0, 0, 0];
  return [239, 68, 68, 200];
}`;

export function sarFloodProxy({ fetchImpl = fetch } = {}) {
  const state = {
    token: null,
    tokenExpires: 0,
    latestPass: null,
    baselinePasses: [],
    png: null,
    renderedAt: 0,
    checkedAt: 0,
    error: null,
  };
  let inflight = null;

  const configured = () =>
    Boolean(
      String(process.env.CDSE_CLIENT_ID || '').trim() &&
        String(process.env.CDSE_CLIENT_SECRET || '').trim(),
    );

  async function authHeader() {
    if (!state.token || Date.now() > state.tokenExpires - 60_000) {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: String(process.env.CDSE_CLIENT_ID).trim(),
        client_secret: String(process.env.CDSE_CLIENT_SECRET).trim(),
      });
      const r = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`Copernicus auth HTTP ${r.status}`);
      const j = await r.json();
      state.token = j.access_token;
      state.tokenExpires = Date.now() + Number(j.expires_in || 600) * 1000;
    }
    return { Authorization: `Bearer ${state.token}` };
  }

  async function passDates(fromIso, toIso) {
    const r = await fetchImpl(CATALOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({
        collections: ['sentinel-1-grd'],
        bbox: SAR_FLOOD_BBOX,
        datetime: `${fromIso}/${toIso}`,
        limit: 100,
        filter: "sar:instrument_mode = 'IW'",
        'filter-lang': 'cql2-text',
        fields: { include: ['properties.datetime'], exclude: ['assets', 'links', 'geometry'] },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`Copernicus catalog HTTP ${r.status}`);
    const j = await r.json();
    const dates = new Set(
      (j.features || []).map((f) => String(f?.properties?.datetime || '').slice(0, 10)),
    );
    dates.delete('');
    return [...dates].sort().reverse();
  }

  async function render(fromIso, toIso) {
    const body = {
      input: {
        bounds: {
          bbox: SAR_FLOOD_BBOX,
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [
          {
            type: 'sentinel-1-grd',
            dataFilter: {
              timeRange: { from: fromIso, to: toIso },
              acquisitionMode: 'IW',
              polarization: 'DV',
            },
            processing: {
              orthorectify: true,
              demInstance: 'COPERNICUS_30',
              backCoeff: 'SIGMA0_ELLIPSOID',
              speckleFilter: { type: 'LEE', windowSizeX: 5, windowSizeY: 5 },
            },
          },
        ],
      },
      output: {
        width: WIDTH,
        height: HEIGHT,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript: SAR_FLOOD_EVALSCRIPT,
    };
    const r = await fetchImpl(PROCESS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'image/png',
        ...(await authHeader()),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (r.status === 403)
      throw new Error('Copernicus 403: out of Processing Units or not permitted');
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 200);
      throw new Error(`Copernicus process HTTP ${r.status} ${detail}`);
    }
    return Buffer.from(await r.arrayBuffer());
  }

  async function refresh() {
    if (!configured()) return;
    if (Date.now() - state.checkedAt < CHECK_MS && state.png) return;
    try {
      const now = new Date();
      const from = new Date(now.getTime() - LOOKBACK_DAYS * 86400e3);
      const dates = await passDates(from.toISOString(), now.toISOString());
      state.checkedAt = Date.now();
      if (dates.length < 2) {
        state.error = 'Not enough Sentinel-1 passes in the lookback window';
        return;
      }
      const latest = dates[0];
      if (latest === state.latestPass && state.png) return;
      const baseline = dates.slice(1, 1 + BASELINE_PASSES);
      const windowStart = `${baseline[baseline.length - 1]}T00:00:00Z`;
      const windowEnd = `${latest}T23:59:59Z`;
      state.png = await render(windowStart, windowEnd);
      state.latestPass = latest;
      state.baselinePasses = baseline;
      state.renderedAt = Date.now();
      state.error = null;
      console.log(`[SAR flood] rendered pass ${latest} vs ${baseline.join(', ')}`);
    } catch (error) {
      state.checkedAt = Date.now();
      state.error = error?.message || String(error);
      console.warn('[SAR flood]', state.error);
    }
  }

  function kick() {
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function install(server) {
    server.middlewares.use('/api/sar-flood', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'GET') {
        res.writeHead(405);
        return res.end();
      }
      if (url.pathname === '/status') {
        // First call waits for a render; later calls answer immediately.
        if (!state.png) await kick();
        else kick();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        return res.end(
          JSON.stringify({
            configured: configured(),
            available: Boolean(state.png),
            latestPass: state.latestPass,
            baselinePasses: state.baselinePasses,
            renderedAt: state.renderedAt || null,
            bbox: SAR_FLOOD_BBOX,
            error: state.png ? null : state.error,
            attribution: 'Contains modified Copernicus Sentinel-1 data',
          }),
        );
      }
      if (url.pathname === '/new-water.png') {
        if (!state.png) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No flood map rendered yet' }));
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': state.png.length,
          'Cache-Control': 'public, max-age=3600',
        });
        return res.end(state.png);
      }
      res.writeHead(404);
      res.end();
    });
  }

  return {
    name: 'sar-flood-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
