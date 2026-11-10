/**
 * Marine buoys (NDBC), airport weather (aviationweather.gov METAR),
 * North Atlantic right whale Seasonal Management Areas (NOAA Fisheries) and
 * Atlantic City tower radio transcripts (local Fire Wire/LiveATC pipeline).
 */
import { createSource, fetchJson, fetchText, num } from './core.js';
import { capeDispatchOrigin } from '../../../src/publicExposure.mjs';

// ---------------- NDBC buoys -------------------------------------------
// Station ids near Cape May. Coordinates come from NDBC's own station
// list (activestations.xml), never typed in here.
const BUOY_IDS = ['44009', 'CMAN4', 'BRND1', 'LWSD1', 'ACYN4', '44091'];
let stationMeta = { at: 0, byId: {} };

async function buoyMeta() {
  if (Date.now() - stationMeta.at < 24 * 3600e3) return stationMeta.byId;
  const xml = await fetchText('https://www.ndbc.noaa.gov/activestations.xml');
  const byId = {};
  for (const m of xml.matchAll(/<station\s+([^>]+?)\/?>/g)) {
    const attr = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    if (attr.id) byId[attr.id.toUpperCase()] = attr;
  }
  stationMeta = { at: Date.now(), byId };
  return byId;
}

function parseRealtime2(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 3) return null;
  const header = lines[0].replace(/^#/, '').trim().split(/\s+/);
  const row = lines.find((l, i) => i > 0 && !l.startsWith('#'));
  if (!row) return null;
  const cols = row.trim().split(/\s+/);
  const f = Object.fromEntries(header.map((h, i) => [h, cols[i] === 'MM' ? null : cols[i]]));
  const t = Date.UTC(+f.YY, +f.MM - 1, +f.DD, +f.hh, +f.mm);
  return {
    observedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    windDirDeg: num(f.WDIR),
    windSpeedKt: num(f.WSPD) === null ? null : Math.round(num(f.WSPD) * 1.94384 * 10) / 10,
    gustKt: num(f.GST) === null ? null : Math.round(num(f.GST) * 1.94384 * 10) / 10,
    waveHeightFt: num(f.WVHT) === null ? null : Math.round(num(f.WVHT) * 3.28084 * 10) / 10,
    dominantPeriodS: num(f.DPD),
    pressureMb: num(f.PRES),
    airTempF: num(f.ATMP) === null ? null : Math.round((num(f.ATMP) * 9) / 5 + 32),
    waterTempF: num(f.WTMP) === null ? null : Math.round((num(f.WTMP) * 9) / 5 + 32),
  };
}

export const buoys = createSource({
  name: 'marine-buoys',
  source: { name: 'NOAA National Data Buoy Center', url: 'https://www.ndbc.noaa.gov/', license: 'Public domain (US Government)' },
  ttlMs: 15 * 60e3,
  staleAfterMs: 90 * 60e3,
  async load() {
    const meta = await buoyMeta();
    const features = [];
    for (const id of BUOY_IDS) {
      const m = meta[id];
      if (!m) continue; // not an active NDBC station today: not shown
      let obs = null;
      let error = null;
      try {
        obs = parseRealtime2(await fetchText(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`));
      } catch (e) {
        error = e.message;
      }
      const age = obs?.observedAt ? Date.now() - Date.parse(obs.observedAt) : Infinity;
      const reporting = age < 3 * 3600e3;
      const name = m.name || id;
      features.push({
        id: `ndbc:${id}`,
        kind: 'buoy',
        geometry: { type: 'Point', lat: Number(m.lat), lon: Number(m.lon) },
        title: `${name} (${id})`,
        stationId: id,
        stationType: m.type || null,
        status: reporting ? 'observed' : 'not-reporting',
        observedAt: obs?.observedAt || null,
        reading: obs,
        error,
        color: reporting ? '#4cc9f0' : '#6b7785',
        label: reporting
          ? `${id}${obs.waveHeightFt != null ? ` · waves ${obs.waveHeightFt} ft` : ''}${obs.waterTempF != null ? ` · water ${obs.waterTempF}°F` : ''}`
          : `${id} · not reporting`,
        link: `https://www.ndbc.noaa.gov/station_page.php?station=${id.toLowerCase()}`,
      });
    }
    if (!features.length) throw new Error('No NDBC stations found');
    return { features };
  },
});

// ---------------- Airport weather (METAR) ---------------------------------
const FLIGHT_CAT_COLOR = { VFR: '#22c55e', MVFR: '#3b82f6', IFR: '#ef4444', LIFR: '#e879f9' };

export const airportWeather = createSource({
  name: 'airport-weather',
  source: { name: 'NOAA Aviation Weather Center (METAR)', url: 'https://aviationweather.gov/', license: 'Public domain (US Government)' },
  ttlMs: 10 * 60e3,
  staleAfterMs: 90 * 60e3,
  async load() {
    // Same box Cape Dispatch used: roughly Philadelphia to Salisbury.
    const rows = await fetchJson('https://aviationweather.gov/api/data/metar?bbox=38.3,-76.0,40.2,-73.8&format=json');
    const features = [];
    for (const r of rows || []) {
      const lat = num(r.lat);
      const lon = num(r.lon);
      if (lat === null || lon === null) continue;
      const obsMs = r.obsTime ? r.obsTime * 1000 : Date.parse(r.reportTime || '');
      const reporting = Number.isFinite(obsMs) && Date.now() - obsMs < 3 * 3600e3;
      const cat = r.fltCat || r.fltcat || null;
      const windKt = num(r.wspd);
      const gustKt = num(r.wgst);
      const tempF = num(r.temp) === null ? null : Math.round((num(r.temp) * 9) / 5 + 32);
      features.push({
        id: `metar:${r.icaoId}`,
        kind: 'airport-weather',
        geometry: { type: 'Point', lat, lon },
        title: `${r.icaoId} · ${String(r.name || '').split(',')[0]}`,
        icao: r.icaoId,
        status: reporting ? 'observed' : 'not-reporting',
        observedAt: Number.isFinite(obsMs) ? new Date(obsMs).toISOString() : null,
        flightCategory: cat,
        windDirDeg: typeof r.wdir === 'number' ? r.wdir : r.wdir || null,
        windKt,
        gustKt,
        visibility: r.visib ?? null,
        tempF,
        altimeterInHg: num(r.altim) === null ? null : Math.round(num(r.altim) * 0.02953 * 100) / 100,
        rawMetar: r.rawOb || null,
        color: reporting ? FLIGHT_CAT_COLOR[cat] || '#9aa5b1' : '#6b7785',
        label: reporting
          ? `${r.icaoId}${cat ? ` ${cat}` : ''}${windKt != null ? ` · ${windKt}${gustKt ? `G${gustKt}` : ''} kt` : ''}${tempF != null ? ` · ${tempF}°F` : ''}`
          : `${r.icaoId} · no recent report`,
        link: `https://aviationweather.gov/data/metar/?id=${r.icaoId}`,
      });
    }
    if (!features.length) throw new Error('No METAR reports in the region');
    return { features };
  },
});

// ---------------- Right whale Seasonal Management Areas -------------------
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function smaInEffect(text, today = new Date()) {
  const m = /^\s*([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2})\s*$/.exec(text || '');
  if (!m) return null;
  const a = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const b = MONTHS.indexOf(m[3].toLowerCase()) + 1;
  if (!a || !b) return null;
  const s = [a, +m[2]];
  const e = [b, +m[4]];
  const cur = [today.getMonth() + 1, today.getDate()];
  const le = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]);
  return le(s, e) ? le(s, cur) && le(cur, e) : le(s, cur) || le(cur, e);
}

export const whaleZones = createSource({
  name: 'whale-zones',
  source: {
    name: 'NOAA Fisheries — Right whale Seasonal Management Areas (50 CFR 224.105)',
    url: 'https://www.fisheries.noaa.gov/national/endangered-species-conservation/reducing-vessel-strikes-north-atlantic-right-whales',
    license: 'Public domain (US Government)',
  },
  ttlMs: 24 * 3600e3,
  staleAfterMs: 7 * 24 * 3600e3,
  async load() {
    const q = new URLSearchParams({
      where: '1=1',
      outFields: 'location,restrictedperiod,restriction,cfrsection',
      geometry: '-76.0,38.0,-73.0,40.3',
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outSR: '4326',
      f: 'geojson',
    });
    const gj = await fetchJson(
      `https://coast.noaa.gov/arcgis/rest/services/Hosted/NorthAtlanticRightWhaleSeasonalManagementAreas/FeatureServer/0/query?${q}`,
    );
    const features = [];
    for (const [i, f] of (gj.features || []).entries()) {
      const p = f.properties || {};
      const g = f.geometry;
      const rings = g?.type === 'Polygon' ? [g.coordinates[0]] : g?.type === 'MultiPolygon' ? g.coordinates.map((c) => c[0]) : [];
      if (!rings.length) continue;
      const active = smaInEffect(p.restrictedperiod);
      features.push({
        id: `sma:${p.location || i}`,
        kind: 'whale-zone',
        geometry: { type: 'Polygon', rings },
        title: `Right whale SMA · ${p.location || 'Mid-Atlantic'}`,
        period: p.restrictedperiod || null,
        restriction: p.restriction || null,
        regulation: p.cfrsection || '50 CFR 224.105',
        inEffect: active,
        status: 'regulatory',
        observedAt: null,
        color: active ? '#ffd43b' : '#6b7785',
        label: `Whale SMA · ${active ? 'IN EFFECT' : active === false ? 'not in effect' : 'check dates'}`,
      });
    }
    if (!features.length) throw new Error('No Seasonal Management Areas returned');
    return { features };
  },
});

// ---------------- Atlantic City tower radio transcripts -------------------
// The LiveATC capture (C:\capemay-scanner\liveatc_kacy.py) saves routine
// tower traffic for Cape Dispatch's aviation deck; that app serves it at
// /api/atc/live_feed. Read it over HTTP (read-only) — never its database.
const KACY = { lat: 39.4576, lon: -74.5772 };

export const airportRadio = createSource({
  name: 'airport-radio',
  source: {
    name: 'LiveATC KACY tower/approach audio, transcribed locally (Whisper)',
    url: 'https://www.liveatc.net/',
    license: 'Machine transcripts; may contain errors. Audio rights: LiveATC terms apply.',
  },
  ttlMs: 30e3,
  staleAfterMs: 10 * 60e3,
  async load() {
    const resolved = capeDispatchOrigin();
    if (!resolved.ok) throw new Error('Airport radio recorder is not on a local origin');
    const base = resolved.origin;
    const d = await fetchJson(`${base}/api/atc/live_feed?limit=60`, { timeoutMs: 8000 });
    const features = [];
    for (const t of d.transmissions || []) {
      const at = t.pub_ms ? new Date(t.pub_ms).toISOString() : t.timestamp ? `${String(t.timestamp).replace(' ', 'T')}Z` : null;
      const file = String(t.audio_url || '').split('/').pop();
      const title = String(t.title || 'ATC Radio Transmission')
        .replace(/[^\x20-\x7E]+/g, '·')
        .replace(/\s*·\s*/g, ' · ');
      features.push({
        id: `atc:${t.id}`,
        kind: 'airport-radio',
        geometry: { type: 'Point', lat: Number.isFinite(t.lat) ? t.lat : KACY.lat, lon: Number.isFinite(t.lng) ? t.lng : KACY.lon },
        title,
        transcript: t.transcript || null,
        transcriptNote: 'Automatic transcript (Whisper) — may contain errors',
        audio: /^[A-Za-z0-9_-]{1,120}\.mp3$/.test(file) ? `/api/scanner/audio/${file}` : null,
        callsigns: t.callsigns || [],
        runway: t.runway || null,
        facility: t.facility || null,
        emergency: Boolean(t.is_emergency),
        status: 'transcribed',
        observedAt: at,
        color: t.is_emergency ? '#ff3b3b' : '#4cc9f0',
        label: title,
      });
    }
    const newest = features.map((f) => Date.parse(f.observedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    const quietMin = newest ? Math.round((Date.now() - newest) / 60000) : null;
    const stalled = quietMin === null || quietMin > 45;
    return {
      features,
      status: stalled ? 'delayed' : 'live',
      note: stalled
        ? `No new tower transmissions recorded for ${quietMin ?? 'an unknown number of'} minutes. The airport may be quiet, or the recorder may have stopped.`
        : null,
      summary: { count: features.length, newestMinutesAgo: quietMin },
    };
  },
});
