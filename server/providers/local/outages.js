/**
 * Atlantic City Electric power outages for Cape May, Atlantic and Cumberland
 * counties, town by town (the utility's public outage map, Kubra Storm
 * Center). Counts are customers out as the utility reports them; towns are
 * placed at their OpenStreetMap/Nominatim centroid (geocoded once, cached).
 * Ported from Cape Dispatch's power_outages.py.
 */
import { createSource, fetchJson, fetchText, readDiskCache, writeDiskCache } from './core.js';

const BASE = 'https://phi-ace.outagemaps.com/bpu/sc5';
const MAP_PAGE = 'https://outagemap.atlanticcityelectric.com/';
const ids = {
  sc: '4b4c1b8f-d2fe-4d2a-877d-a704f764db98',
  view: '7f053cec-c706-4e9b-90d7-cc001b17e38b',
  report: '378fe3e0-908c-444b-9221-3aa8c1cd28c2',
};
const REGION = ['CAPE MAY', 'ATLANTIC', 'CUMBERLAND'];
const BROWSER_UA = { 'User-Agent': 'Mozilla/5.0 (compatible; GodsEyeView/0.3)' };

let centroids = readDiskCache('town-centroids') || {};
let geocodeQueue = Promise.resolve();

function townLabel(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\btwp\b/g, 'township')
    .replace(/\bboro\b/g, 'borough')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Nominatim, at most one request a second, cached on disk forever. */
function geocode(town, county) {
  const key = `${town}|${county}`;
  if (key in centroids) return Promise.resolve(centroids[key]);
  geocodeQueue = geocodeQueue.then(async () => {
    if (key in centroids) return;
    await new Promise((r) => setTimeout(r, 1100));
    try {
      const q = encodeURIComponent(`${town}, ${county} County, New Jersey`);
      const rows = await fetchJson(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
      );
      const row = rows?.[0];
      centroids[key] = row ? { lat: Number(row.lat), lon: Number(row.lon) } : null;
    } catch {
      return; // retry on a later refresh
    }
    writeDiskCache('town-centroids', centroids);
  });
  return geocodeQueue.then(() => centroids[key] ?? null);
}

async function rediscover() {
  const html = await fetchText(MAP_PAGE, { headers: BROWSER_UA });
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const found = html.match(uuid) || [];
  if (found[0]) ids.sc = found[0];
  if (found[1]) ids.view = found[1];
}

async function currentInterval() {
  const url = () =>
    `${BASE}/stormcenter/api/v1/stormcenters/${ids.sc}/views/${ids.view}/currentState`;
  try {
    return (await fetchJson(url(), { headers: BROWSER_UA })).data.interval_generation_data;
  } catch {
    await rediscover();
    return (await fetchJson(url(), { headers: BROWSER_UA })).data.interval_generation_data;
  }
}

async function load() {
  const interval = await currentInterval();
  const report = await fetchJson(`${BASE}/${interval}/public/reports/${ids.report}_report.json`, {
    headers: BROWSER_UA,
  });
  const generated = report?.file_title || report?.file_data?.generated || null;
  const counties = [];
  const features = [];
  for (const c of report?.file_data?.areas || []) {
    const cname = String(c.name || '').toUpperCase();
    if (!REGION.includes(cname)) continue;
    const county = townLabel(cname);
    counties.push({
      county,
      out: c.cust_a?.val || 0,
      served: c.cust_s ?? null,
      outages: c.n_out || 0,
      etr: c.etr || null,
    });
    for (const a of c.areas || []) {
      const out = a.cust_a?.val || 0;
      const town = townLabel(a.name);
      const centroid = await geocode(town, county);
      features.push({
        id: `ace:${cname}:${a.name}`,
        kind: 'outage-town',
        geometry: centroid ? { type: 'Point', lat: centroid.lat, lon: centroid.lon } : null,
        title: town,
        county,
        customersOut: out,
        customersServed: a.cust_s ?? null,
        percentOut: a.cust_s ? Math.round((1000 * out) / a.cust_s) / 10 : null,
        outageCount: a.n_out || 0,
        etr: a.etr && a.etr !== 'ETR-NULL' ? a.etr : null,
        status: 'reported',
        observedAt: null,
        color: out === 0 ? '#4cc9f0' : out < 50 ? '#ffd43b' : out < 500 ? '#ff9f1a' : '#ff3b3b',
        label: out ? `${town} · ${out.toLocaleString('en-US')} out` : `${town} · 0 out`,
        showOnMap: out > 0,
      });
    }
  }
  if (!counties.length) throw new Error('Outage report had no shore counties');
  features.sort((a, b) => b.customersOut - a.customersOut);
  return {
    features,
    summary: {
      counties,
      totalOut: counties.reduce((n, c) => n + c.out, 0),
      reportGenerated: generated,
      townsWithOutages: features.filter((f) => f.customersOut > 0).length,
    },
  };
}

export const outages = createSource({
  name: 'power-outages',
  source: {
    name: 'Atlantic City Electric outage map',
    url: MAP_PAGE,
    license: 'Public utility outage map; customer counts as reported by the utility',
  },
  ttlMs: 5 * 60e3,
  staleAfterMs: 30 * 60e3,
  load,
});
