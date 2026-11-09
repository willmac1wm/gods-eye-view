/**
 * EPA AirNow proxy for the Air quality layer (US monitors).
 *
 *   GET /api/airnow → { readings: [...], fetchedAt } (latest AQI per site)
 *
 * The AirNow key (AIRNOW_API_KEY) stays on the server. One upstream request
 * per 10 minutes serves every browser; AirNow publishes hourly. The query box
 * defaults to South Jersey / Delaware / Philadelphia and is overridable with
 * AIRNOW_BBOX="minLon,minLat,maxLon,maxLat".
 */

const API_URL = 'https://www.airnowapi.org/aq/data/';
const CACHE_MS = 10 * 60 * 1000;
const DEFAULT_BBOX = '-76.2,38.3,-73.8,40.4';

function hourStamp(date) {
  return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

/** Latest AQI row per site, preferring the worst pollutant at that hour. */
export function normalizeAirNowRows(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return null;
  const bySite = new Map();
  for (const row of rows) {
    const lat = Number(row?.Latitude);
    const lon = Number(row?.Longitude);
    const aqi = Number(row?.AQI);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!Number.isFinite(aqi) || aqi < 0) continue;
    const observedMs = Date.parse(`${row?.UTC}:00Z`);
    if (!Number.isFinite(observedMs) || now - observedMs > 6 * 3600e3) continue;
    const siteId = String(row?.FullAQSCode || row?.IntlAQSCode || `${lat},${lon}`);
    const prev = bySite.get(siteId);
    if (
      prev &&
      (prev.observedMs > observedMs ||
        (prev.observedMs === observedMs && prev.aqi >= aqi))
    )
      continue;
    bySite.set(siteId, {
      siteId,
      name: String(row?.SiteName || 'AirNow monitor').trim(),
      agency: String(row?.AgencyName || '').trim(),
      parameter: String(row?.Parameter || '').trim(),
      aqi: Math.round(aqi),
      lat,
      lon,
      observedMs,
    });
  }
  return [...bySite.values()];
}

export function airNowProxy({ fetchImpl = fetch } = {}) {
  let cache = { at: 0, body: null };
  let inflight = null;

  async function refresh() {
    const key = String(process.env.AIRNOW_API_KEY || '').trim();
    if (!key) return { status: 503, body: { error: 'AirNow is not configured' } };
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 3600e3);
    const url = new URL(API_URL);
    url.searchParams.set('startDate', hourStamp(start));
    url.searchParams.set('endDate', hourStamp(end));
    url.searchParams.set('parameters', 'OZONE,PM25,PM10');
    url.searchParams.set('BBOX', String(process.env.AIRNOW_BBOX || DEFAULT_BBOX));
    url.searchParams.set('dataType', 'A');
    url.searchParams.set('format', 'application/json');
    url.searchParams.set('verbose', '1');
    url.searchParams.set('monitorType', '0');
    url.searchParams.set('includerawconcentrations', '0');
    url.searchParams.set('API_KEY', key);
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
    if (!response.ok)
      return { status: 502, body: { error: `AirNow HTTP ${response.status}` } };
    const readings = normalizeAirNowRows(await response.json());
    if (!readings) return { status: 502, body: { error: 'Malformed AirNow response' } };
    const body = { readings, fetchedAt: Date.now() };
    cache = { at: Date.now(), body };
    return { status: 200, body };
  }

  function install(server) {
    server.middlewares.use('/api/airnow', async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') return send(405, { error: 'GET only' });
      if (cache.body && Date.now() - cache.at < CACHE_MS) return send(200, cache.body);
      try {
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        const result = await inflight;
        // Serve the last good snapshot rather than an error when one exists.
        if (result.status !== 200 && cache.body) return send(200, cache.body);
        return send(result.status, result.body);
      } catch (error) {
        console.warn('[AirNow] fetch failed:', error?.message || error);
        if (cache.body) return send(200, cache.body);
        return send(502, { error: 'AirNow unavailable' });
      }
    });
  }

  return {
    name: 'airnow-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
