/**
 * Predicted coastal flooding — an ESTIMATE, ported from Cape Dispatch's
 * flood_map.py and kept just as cautious:
 *
 *  1. Tidal NWS gauges with a forecast peak give water height above MHHW
 *     (normal high tide) = forecast (ft MLLW) - MHHW offset.
 *  2. Only a forecast at FLOOD STAGE or worse (action/minor/moderate/major)
 *     produces a level; anything below shades nothing. With no forecast, a
 *     gauge flooding right now is used instead.
 *  3. The browser draws NOAA's Sea Level Rise Viewer inundation tiles for
 *     that level (nearest gauge within 40 km), minus the 0 ft tile, so only
 *     ground that newly floods is shaded.
 *
 * NOAA's bathtub model ignores wave run-up, drainage, pumps and barrier
 * failures. It is a planning estimate, not an official flood forecast.
 */
import { gauges } from './gauges.js';
import { readDiskCache, writeDiskCache } from './core.js';

const FLOOD = ['action', 'minor', 'moderate', 'major'];
export const SLR_TILE_BOUNDS = { south: 38.85, west: -75.45, north: 39.75, east: -74.3 };

function roundLevel(ft) {
  return Math.max(0, Math.min(10, Math.round(ft * 2) / 2));
}

export async function predictedFloodingPlan() {
  const g = await gauges.get();
  const tidal = g.features.filter((f) => f.kind === 'flood-gauge' && f.tidal && f.mhhwFt != null);
  const withForecast = tidal.filter((f) => f.forecast);
  const use = withForecast.length ? withForecast : tidal.filter((f) => FLOOD.includes(f.observed?.category));
  const anchors = [];
  for (const f of use) {
    const src = f.forecast || f.observed;
    if (src?.value == null) continue;
    const above = Math.round((src.value - f.mhhwFt) * 100) / 100;
    const floods = FLOOD.includes(src.category);
    anchors.push({
      gauge: f.title,
      lid: f.lid,
      lat: f.geometry.lat,
      lon: f.geometry.lon,
      aboveMhhwFt: above,
      levelFt: floods ? roundLevel(above) : 0,
      category: src.category,
      time: src.time,
      basis: f.forecast ? 'forecast' : 'observed now',
    });
  }
  const flooding = anchors.filter((a) => a.levelFt > 0);
  return {
    source: {
      name: 'NOAA Sea Level Rise Viewer inundation + NWS gauge forecasts',
      url: 'https://coast.noaa.gov/slr/',
      license: 'Public domain (US Government)',
    },
    fetchedAt: g.fetchedAt,
    status: g.status === 'live' ? (flooding.length ? 'estimated' : 'no-flood-forecast') : g.status,
    note: flooding.length
      ? 'ESTIMATE: NOAA bathtub model at the forecast water level. Ignores waves, drainage, pumps and barrier failures. Not an official flood forecast — follow NWS and county OEM guidance.'
      : 'No tidal gauge is forecast to reach flood stage, so there is nothing to estimate.',
    anchors,
    active: flooding.length > 0,
    maxLevelFt: Math.max(0, ...anchors.map((a) => a.levelFt)),
    version: anchors.map((a) => `${a.lid}${a.levelFt}`).sort().join('-') || 'none',
    features: flooding.map((a) => ({
      id: `flood-est:${a.lid}`,
      kind: 'flood-estimate',
      geometry: { type: 'Point', lat: a.lat, lon: a.lon },
      title: `Estimated flooding near ${a.gauge}`,
      gauge: a.gauge,
      aboveMhhwFt: a.aboveMhhwFt,
      levelFt: a.levelFt,
      category: a.category,
      basis: a.basis,
      time: a.time,
      status: 'estimated',
      observedAt: null,
      color: '#ff9f1a',
      label: `ESTIMATE · ~${a.levelFt} ft above normal high tide`,
    })),
  };
}

const TILE_SVC = /^slr_(?:\d|10)(?:_5)?ft$/;

function tileCenter(z, x, y) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** Proxy (and disk-cache) one NOAA SLR tile inside the three-county box. */
export async function slrTile(svc, z, y, x) {
  if (!TILE_SVC.test(svc) || z < 10 || z > 16) return null;
  const c = tileCenter(z, x, y);
  const b = SLR_TILE_BOUNDS;
  if (c.lat < b.south - 0.2 || c.lat > b.north + 0.2 || c.lon < b.west - 0.2 || c.lon > b.east + 0.2) return null;
  const key = `slr-${svc}-${z}-${y}-${x}`;
  const cached = readDiskCache(key);
  if (cached?.b64) return Buffer.from(cached.b64, 'base64');
  const r = await fetch(
    `https://www.coast.noaa.gov/arcgis/rest/services/dc_slr/${svc}/MapServer/tile/${z}/${y}/${x}`,
    { signal: AbortSignal.timeout(20000) },
  );
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024) return null;
  writeDiskCache(key, { b64: buf.toString('base64') });
  return buf;
}
