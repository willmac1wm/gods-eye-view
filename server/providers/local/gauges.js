/**
 * Tide and flood gauges for Cape May, Atlantic and Cumberland counties.
 *
 *  - NWS National Water Prediction Service (api.water.noaa.gov/nwps/v1):
 *    every gauge in the box with its latest OBSERVED reading and, where one
 *    is issued, the FORECAST peak — each classified against the gauge's
 *    official flood stages. Tidal gauges read ft above MLLW; river gauges
 *    read ft of stage. Values are never compared across the two.
 *  - NOAA CO-OPS (tidesandcurrents.noaa.gov): latest OBSERVED water level
 *    and the next PREDICTED high/low tides at Cape May, Atlantic City and
 *    Lewes. Predictions are astronomical tides only (no surge).
 *
 * Ported from Cape Dispatch's flood_gauges.py.
 */
import { createSource, fetchJson, num } from './core.js';

const NWPS = 'https://api.water.noaa.gov/nwps/v1';
const BBOX =
  'bbox.xmin=-75.45&bbox.ymin=38.85&bbox.xmax=-74.30&bbox.ymax=39.75&srid=EPSG_4326';
const OBS_STALE_MS = 3 * 3600e3;
const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const TIDE_STATIONS = [
  { id: '8536110', name: 'Cape May, NJ', lat: 38.9683, lon: -74.96 },
  { id: '8534720', name: 'Atlantic City, NJ', lat: 39.356667, lon: -74.41805 },
  { id: '8557380', name: 'Lewes, DE', lat: 38.782833, lon: -75.11928 },
];
const CATEGORY_ORDER = ['no_flooding', 'action', 'minor', 'moderate', 'major'];
const CATEGORY_COLOR = {
  no_flooding: '#4cc9f0',
  action: '#ffd43b',
  minor: '#ff9f1a',
  moderate: '#ff3b3b',
  major: '#c13bff',
};
const stages = new Map(); // lid -> {at, action, minor, moderate, major}

function category(c) {
  const v = String(c || '').toLowerCase().replace(/\s+/g, '_');
  return CATEGORY_ORDER.includes(v) ? v : null;
}

async function stagesFor(lid) {
  const hit = stages.get(lid);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return hit;
  try {
    const d = await fetchJson(`${NWPS}/gauges/${lid}`);
    const cats = d?.flood?.categories || {};
    const entry = { at: Date.now(), mhhw: null };
    for (const k of ['action', 'minor', 'moderate', 'major']) {
      const v = num(cats[k]?.stage);
      entry[k] = v !== null && v > -900 ? v : null; // NWPS uses -9999 for "not defined"
    }
    // NWPS lists tidal datums relative to the gauge zero with the sign flipped
    // (CAPN4 "MHHW*": -5.006 means MHHW is 5.006 ft above the MLLW zero).
    const vertical = d?.datums?.vertical;
    const items = Array.isArray(vertical) ? vertical : vertical?.value;
    for (const item of items || []) {
      if (String(item?.abbrev || '').replace(/\*$/, '').toUpperCase() === 'MHHW') {
        const v = num(item.value);
        entry.mhhw = v === null ? null : -v;
      }
    }
    stages.set(lid, entry);
    return entry;
  } catch {
    return hit || null;
  }
}

function nextTides(predictions) {
  const now = Date.now();
  return predictions
    .map((p) => ({
      time: new Date(`${String(p.t).replace(' ', 'T')}:00Z`).toISOString(),
      ft: num(p.v) === null ? null : Math.round(num(p.v) * 10) / 10,
      type: p.type === 'H' ? 'high' : 'low',
    }))
    .filter((p) => Date.parse(p.time) >= now && p.ft !== null)
    .slice(0, 4);
}

async function loadTideStation(st) {
  const base = `${COOPS}?station=${st.id}&datum=MLLW&units=english&time_zone=gmt&format=json&application=GodsEyeView`;
  const out = {
    id: `coops:${st.id}`,
    kind: 'tide-station',
    geometry: { type: 'Point', lat: st.lat, lon: st.lon },
    title: st.name,
    stationId: st.id,
    datum: 'ft above MLLW',
    link: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${st.id}`,
    observed: null,
    predictions: [],
    errors: [],
  };
  try {
    const wl = await fetchJson(`${base}&product=water_level&date=latest`);
    const row = wl?.data?.[0];
    if (row) {
      out.observed = {
        value: num(row.v) === null ? null : Math.round(num(row.v) * 100) / 100,
        unit: 'ft',
        time: new Date(`${row.t.replace(' ', 'T')}:00Z`).toISOString(),
        quality: row.q === 'p' ? 'preliminary' : row.q === 'v' ? 'verified' : null,
      };
    } else if (wl?.error) out.errors.push(wl.error.message);
  } catch (error) {
    out.errors.push(`water level: ${error.message}`);
  }
  try {
    const begin = new Date(Date.now() - 3600e3)
      .toISOString()
      .slice(0, 16)
      .replace(/-/g, '')
      .replace('T', ' ');
    const pred = await fetchJson(
      `${base}&product=predictions&interval=hilo&begin_date=${encodeURIComponent(begin)}&range=48`,
    );
    out.predictions = nextTides(pred?.predictions || []);
  } catch (error) {
    out.errors.push(`predictions: ${error.message}`);
  }
  const obsAge = out.observed ? Date.now() - Date.parse(out.observed.time) : Infinity;
  out.status = out.observed && obsAge <= OBS_STALE_MS ? 'observed' : 'not-reporting';
  out.observedAt = out.observed?.time || null;
  out.color = out.status === 'observed' ? '#4cc9f0' : '#6b7785';
  out.label =
    out.status === 'observed'
      ? `${out.title.replace(/, (NJ|DE)$/, '')} ${out.observed.value?.toFixed(1)} ft`
      : `${out.title} · not reporting`;
  return out;
}

async function load() {
  const features = [];
  const notes = [];
  try {
    const d = await fetchJson(`${NWPS}/gauges?${BBOX}`);
    const raw = (d.gauges || []).filter(
      (g) => (g?.state?.abbreviation || 'NJ') === 'NJ',
    );
    for (const g of raw) {
      const lat = num(g.latitude);
      const lon = num(g.longitude);
      if (lat === null || lon === null) continue;
      const name = String(g.name || g.lid || 'Gauge');
      const tidal = /MLLW/i.test(name);
      const obs = g.status?.observed || {};
      const fc = g.status?.forecast || {};
      const obsValue = num(obs.primary);
      const obsTime = obs.validTime || null;
      const obsAge = obsTime ? Date.now() - Date.parse(obsTime) : Infinity;
      const reporting = obsValue !== null && obsAge <= OBS_STALE_MS;
      const fcValue = num(fc.primary);
      const fcTime = fc.validTime || null;
      const hasForecast =
        fcValue !== null && category(fc.floodCategory) && fcTime && Date.parse(fcTime) > Date.now() - 3600e3;
      const obsCat = reporting ? category(obs.floodCategory) : null;
      const fcCat = hasForecast ? category(fc.floodCategory) : null;
      const worst = [obsCat, fcCat]
        .filter(Boolean)
        .sort((a, b) => CATEGORY_ORDER.indexOf(b) - CATEGORY_ORDER.indexOf(a))[0] || null;
      const st = g.lid ? await stagesFor(g.lid) : null;
      const short = name.replace(/\s*\(IN MLLW\)\s*/i, '').trim();
      features.push({
        id: `nwps:${g.lid}`,
        kind: 'flood-gauge',
        geometry: { type: 'Point', lat, lon },
        title: short,
        lid: g.lid,
        tidal,
        datum: tidal ? 'ft above MLLW' : 'ft stage',
        status: reporting ? 'observed' : 'not-reporting',
        observedAt: reporting ? obsTime : null,
        observed: reporting
          ? { value: obsValue, unit: obs.primaryUnit || 'ft', time: obsTime, category: obsCat }
          : null,
        forecast: hasForecast
          ? { value: fcValue, unit: fc.primaryUnit || 'ft', time: fcTime, category: fcCat }
          : null,
        floodStages: st
          ? { action: st.action, minor: st.minor, moderate: st.moderate, major: st.major }
          : null,
        mhhwFt: st?.mhhw ?? null,
        worstCategory: worst,
        color: reporting ? CATEGORY_COLOR[worst || 'no_flooding'] : '#6b7785',
        label: reporting
          ? `${short} ${obsValue.toFixed(1)} ft${worst && worst !== 'no_flooding' ? ` · ${worst.replace('_', ' ')}` : ''}`
          : `${short} · not reporting`,
        link: `https://water.noaa.gov/gauges/${String(g.lid || '').toLowerCase()}`,
      });
    }
  } catch (error) {
    notes.push(`NWPS gauges unavailable: ${error.message}`);
  }
  for (const st of TIDE_STATIONS) features.push(await loadTideStation(st));
  if (!features.length) throw new Error(notes.join('; ') || 'No gauges');

  const flooding = features.filter((f) =>
    ['minor', 'moderate', 'major'].includes(f.worstCategory),
  );
  return {
    features,
    note: notes.join('; ') || null,
    summary: {
      gauges: features.length,
      reporting: features.filter((f) => f.status === 'observed').length,
      flooding: flooding.map((f) => ({
        id: f.id,
        title: f.title,
        category: f.worstCategory,
        now: ['minor', 'moderate', 'major'].includes(f.observed?.category),
        forecastTime: f.forecast?.time || null,
      })),
    },
  };
}

export const gauges = createSource({
  name: 'tide-gauges',
  source: {
    name: 'NOAA/NWS National Water Prediction Service + NOAA CO-OPS',
    url: 'https://water.noaa.gov/',
    license: 'Public domain (US Government)',
  },
  ttlMs: 6 * 60e3,
  staleAfterMs: 30 * 60e3,
  load,
});
