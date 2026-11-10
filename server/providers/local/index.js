/**
 * /api/local/* — Cape May County / South Jersey local-awareness feeds.
 *
 *   GET  /api/local/<source>              envelope (see core.js)
 *   GET  /api/local/predicted-flooding    estimate plan (see predictedFlooding.js)
 *   GET  /api/local/slr-tile/<svc>/<z>/<y>/<x>.png
 *   GET  /api/local/conditions            compact summary of every source,
 *                                         with source + timestamp + status,
 *                                         for the chat tool and County page
 *   POST /api/local/reports               community report (private, pending review)
 *   GET  /api/local/reports               reviewed + approved reports only
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nwsAlerts } from './nwsAlerts.js';
import { gauges } from './gauges.js';
import { outages } from './outages.js';
import { facilities, militaryAreas, trafficIncidents } from './osmAndTraffic.js';
import { buoys, airportWeather, whaleZones, airportRadio } from './marineAir.js';
import { news } from './news.js';
import { predictedFloodingPlan, slrTile } from './predictedFlooding.js';
import { inBox, createSource, fetchJson } from './core.js';
import { normalizeFirewireIncidents } from '../scanner.js';
import { admitSameSiteKeyless } from '../common/same-site.js';

function firewireBase() {
  const list = String(process.env.FIREWIRE_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return (list[0] || String(process.env.FIREWIRE_URL || 'http://127.0.0.1:8000')).replace(/\/+$/, '');
}

const PRIORITY_COLOR = { high: '#ff4d4f', medium: '#ffb020', low: '#4cc9f0', routine: '#8aa4b8' };

/** Police / fire / EMS scanner calls (Fire Wire), public-safe fields only. */
const publicSafetyCalls = createSource({
  name: 'public-safety-calls',
  source: {
    name: 'Fire Wire scanner transcription (Broadcastify feeds)',
    license: 'Machine-transcribed radio traffic. Unconfirmed; not an official dispatch record.',
  },
  ttlMs: 30e3,
  staleAfterMs: 10 * 60e3,
  async load() {
    const base = firewireBase();
    const recent = normalizeFirewireIncidents(await fetchJson(`${base}/api/incidents?hours=48`, { timeoutMs: 6000 })) || [];
    const calls = recent.filter((c) => c.category === 'public-safety');
    let note = null;
    if (!calls.length) {
      // Say when the feed last produced anything, so "empty" is not mistaken for "quiet".
      try {
        const raw = await fetchJson(`${base}/api/incidents?hours=2000`, { timeoutMs: 8000 });
        const rows = (Array.isArray(raw) ? raw : raw?.incidents || []).filter((r) => !/^ATC|KACY/i.test(`${r.incident_type} ${r.location}`));
        const newest = rows.map((r) => r.created_at).sort().pop();
        note = newest
          ? `No police/fire/EMS calls in the last 48 h. The scanner feed last recorded one on ${String(newest).slice(0, 10)} — the feed appears to be offline, not quiet.`
          : 'No police/fire/EMS calls recorded.';
      } catch {
        note = 'No police/fire/EMS calls in the last 48 h.';
      }
    }
    return {
      status: calls.length ? 'live' : 'unavailable',
      note,
      features: calls.map((c) => ({
        id: `call:${c.id}`,
        kind: 'public-safety-call',
        geometry: { type: 'Point', lat: c.lat, lon: c.lon },
        title: c.type,
        location: c.location || null,
        municipality: c.municipality || null,
        priority: c.priority,
        summary: c.summary || null,
        units: c.units,
        audio: c.audio,
        status: 'transcribed',
        observedAt: new Date(c.createdMs).toISOString(),
        color: PRIORITY_COLOR[c.priority] || PRIORITY_COLOR.medium,
        label: `${c.type}${c.location ? ` · ${c.location}` : ''}`,
      })),
    };
  },
});

export const LOCAL_SOURCES = {
  'nws-alerts': nwsAlerts,
  'tide-gauges': gauges,
  'power-outages': outages,
  'emergency-facilities': facilities,
  'traffic-incidents': trafficIncidents,
  'marine-buoys': buoys,
  'airport-weather': airportWeather,
  'whale-zones': whaleZones,
  'military-areas': militaryAreas,
  'airport-radio': airportRadio,
  'public-safety-calls': publicSafetyCalls,
  'local-news': news,
};

const REPORT_DIR = path.join(process.cwd(), '.gev-data', 'community-reports');
const REPORT_CATEGORIES = ['flooding', 'road-hazard', 'power-out', 'storm-damage', 'fire-smoke', 'traffic', 'other'];
const reportRate = new Map(); // ip -> [ms...]

function age(ms) {
  if (!ms) return null;
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Compact, source-labelled snapshot of local conditions. */
export async function localConditions() {
  const get = async (name) => {
    try {
      return await LOCAL_SOURCES[name].get();
    } catch (error) {
      return { status: 'unavailable', note: error.message, features: [] };
    }
  };
  const [alerts, gauge, outage, buoy, metar, incidents, flood] = await Promise.all([
    get('nws-alerts'),
    get('tide-gauges'),
    get('power-outages'),
    get('marine-buoys'),
    get('airport-weather'),
    get('traffic-incidents'),
    predictedFloodingPlan().catch((e) => ({ status: 'unavailable', note: e.message, anchors: [] })),
  ]);
  const meta = (env) => ({
    source: env.source?.name || null,
    updated: env.fetchedAt ? new Date(env.fetchedAt).toISOString() : null,
    updatedAgo: age(env.fetchedAt),
    status: env.status,
    note: env.note || null,
  });
  return {
    generatedAt: new Date().toISOString(),
    disclaimer:
      'Summaries of public data feeds. Not official emergency guidance — follow NWS, Cape May County OEM and 911 instructions.',
    alerts: {
      ...meta(alerts),
      active: alerts.features.map((a) => ({
        event: a.title,
        severity: a.severity,
        area: a.areaDesc,
        expires: a.expires,
        headline: a.headline,
      })),
    },
    floodGauges: {
      ...meta(gauge),
      reporting: gauge.summary?.reporting ?? null,
      atOrAboveFloodStage: (gauge.summary?.flooding || []).map((f) => ({
        gauge: f.title,
        category: f.category,
        observedNow: f.now,
        forecastTime: f.forecastTime,
      })),
      tideStations: gauge.features
        .filter((f) => f.kind === 'tide-station')
        .map((f) => ({
          station: f.title,
          observedFtMLLW: f.observed?.value ?? null,
          observedAt: f.observed?.time ?? null,
          nextTides: f.predictions,
        })),
    },
    predictedFlooding: {
      source: flood.source?.name || null,
      status: flood.status,
      note: flood.note,
      anchors: (flood.anchors || []).filter((a) => a.levelFt > 0),
    },
    powerOutages: { ...meta(outage), byCounty: outage.summary?.counties || [], topTowns: outage.features.filter((f) => f.customersOut > 0).slice(0, 8).map((f) => ({ town: f.title, out: f.customersOut })) },
    marine: { ...meta(buoy), stations: buoy.features.map((f) => ({ station: f.title, status: f.status, observedAt: f.observedAt, waveHeightFt: f.reading?.waveHeightFt ?? null, waterTempF: f.reading?.waterTempF ?? null, windKt: f.reading?.windSpeedKt ?? null })) },
    airports: { ...meta(metar), local: metar.features.filter((f) => ['KACY', 'KWWD', 'KMIV', 'KOBI'].includes(f.icao)).map((f) => ({ airport: f.title, category: f.flightCategory, windKt: f.windKt, gustKt: f.gustKt, tempF: f.tempF, observedAt: f.observedAt, raw: f.rawMetar })) },
    trafficIncidents: { ...meta(incidents), count: incidents.features.length, items: incidents.features.slice(0, 10).map((f) => ({ type: f.title, road: f.road, from: f.from, description: f.description })) },
    radar: { status: 'not-summarized', note: 'Rain radar is an image layer; this summary cannot read rainfall from it. Check the Rain radar layer or NWS.' },
  };
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

async function createReport(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers?.['content-type'] || ''))) {
    return [415, { error: 'Content-Type must be application/json.' }];
  }
  const sockIp = String(req.socket?.remoteAddress || 'unknown');
  const cfIp = String(req.headers?.['cf-connecting-ip'] || '').trim();
  const ip = (sockIp === '127.0.0.1' || sockIp === '::1' || sockIp === '::ffff:127.0.0.1') && cfIp ? cfIp : sockIp;
  const now = Date.now();
  const recent = (reportRate.get(ip) || []).filter((t) => now - t < 3600e3);
  const globalRecent = (reportRate.get('__global__') || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 5 || globalRecent.length >= 40) {
    return [429, { error: 'Too many reports submitted recently. Try again later.' }];
  }
  const body = await readJsonBody(req, 4.5 * 1024 * 1024);
  const text = String(body.text || '').replace(/[<>]/g, '').trim();
  const category = REPORT_CATEGORIES.includes(body.category) ? body.category : 'other';
  if (text.length < 5 || text.length > 1000) return [400, { error: 'Please describe what you are seeing (5–1000 characters).' }];
  let lat = Number(body.lat);
  let lon = Number(body.lon);
  // Store only an approximate location (~100 m) and only inside the region.
  if (Number.isFinite(lat) && Number.isFinite(lon) && inBox(lat, lon)) {
    lat = Math.round(lat * 1000) / 1000;
    lon = Math.round(lon * 1000) / 1000;
  } else {
    lat = null;
    lon = null;
  }
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  let photo = null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.photo || ''));
  if (m) {
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length <= 4 * 1024 * 1024 && buf[0] === 0xff && buf[1] === 0xd8) {
      fs.writeFileSync(path.join(REPORT_DIR, `${id}.jpg`), buf);
      photo = `${id}.jpg`;
    }
  }
  const record = {
    id,
    createdAt: new Date().toISOString(),
    category,
    text,
    town: String(body.town || '').replace(/[<>]/g, '').slice(0, 80) || null,
    lat,
    lon,
    photo,
    status: 'pending-review',
    visibility: 'private',
    verified: false,
  };
  fs.writeFileSync(path.join(REPORT_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  reportRate.set(ip, [...recent, now]);
  reportRate.set('__global__', [...globalRecent, now]);
  return [201, { id, status: record.status, visibility: record.visibility, message: 'Thanks. Your report was saved privately and is waiting for review. It is not public and has not been verified.' }];
}

function approvedReports() {
  let files = [];
  try {
    files = fs.readdirSync(REPORT_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    /* none yet */
  }
  const features = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8'));
      if (r.status !== 'approved' || r.visibility !== 'public' || r.lat == null) continue;
      features.push({
        id: `report:${r.id}`,
        kind: 'community-report',
        geometry: { type: 'Point', lat: r.lat, lon: r.lon },
        title: `Community report · ${r.category.replace('-', ' ')}`,
        text: r.text,
        status: r.verified ? 'verified' : 'unverified',
        observedAt: r.createdAt,
        color: '#c77dff',
        label: `Report · ${r.category.replace('-', ' ')} · unverified`,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return {
    source: { name: 'Community reports (residents)', license: 'Unverified unless marked verified' },
    fetchedAt: Date.now(),
    status: 'live',
    note: features.length
      ? 'Shown after review. Reports are not confirmed facts.'
      : 'No reviewed reports. New reports stay private until a moderator reviews them (review tools are not set up yet).',
    features,
  };
}

export function localAwarenessProxy() {
  function install(server) {
    server.middlewares.use('/api/local', async (req, res) => {
      if (admitSameSiteKeyless(req, res)) return undefined;
      const url = new URL(req.url || '/', 'http://localhost');
      const json = (status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
      };
      try {
        const name = url.pathname.replace(/^\/+|\/+$/g, '');
        if (name === 'reports') {
          if (req.method === 'POST') {
            const [status, body] = await createReport(req);
            return json(status, body);
          }
          return json(200, approvedReports());
        }
        if (req.method !== 'GET') return json(405, { error: 'GET only' });
        if (name === 'conditions') return json(200, await localConditions());
        if (name === 'predicted-flooding') return json(200, await predictedFloodingPlan());
        const tile = /^slr-tile\/([a-z0-9_]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(name);
        if (tile) {
          const buf = await slrTile(tile[1], +tile[2], +tile[3], +tile[4]);
          if (!buf) {
            res.writeHead(204);
            return res.end();
          }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
          return res.end(buf);
        }
        const src = LOCAL_SOURCES[name];
        if (!src) return json(404, { error: 'Unknown local source' });
        return json(200, await src.get());
      } catch (error) {
        return json(500, { error: error?.message || 'Local source error' });
      }
    });
  }
  return { name: 'local-awareness', configureServer: install, configurePreviewServer: install };
}

// ---------------------------------------------------------------------------
// Local-conditions grounding for chat. A cached, compact text snapshot the
// chat handlers append to their system instructions, so "is it flooding?"
// is answered from real feeds with their sources and times — or with a plain
// "that data is unavailable" — never from guesswork.
let snapshot = { at: 0, text: null };
let snapshotInflight = null;

function conditionsText(c) {
  const lines = [];
  const stamp = (m) => `[source: ${m.source || 'unknown'}; updated ${m.updated || 'never'}; status ${m.status}${m.note ? `; note: ${m.note}` : ''}]`;
  lines.push(`Snapshot generated ${c.generatedAt} (UTC).`);
  lines.push(`NWS ALERTS ${stamp(c.alerts)}: ${c.alerts.active.length ? c.alerts.active.map((a) => `${a.event}${a.severity ? ` (${a.severity})` : ''} for ${a.area || 'area not stated'}, until ${a.expires || 'not stated'}`).join(' | ') : c.alerts.status === 'unavailable' ? 'UNAVAILABLE' : 'none active'}`);
  lines.push(`FLOOD GAUGES ${stamp(c.floodGauges)}: ${c.floodGauges.reporting ?? '?'} gauges reporting; at/above flood stage: ${c.floodGauges.atOrAboveFloodStage.length ? c.floodGauges.atOrAboveFloodStage.map((g) => `${g.gauge} ${g.category}${g.observedNow ? ' (OBSERVED now)' : ` (FORECAST for ${g.forecastTime})`}`).join(' | ') : 'none'}`);
  for (const t of c.floodGauges.tideStations)
    lines.push(`TIDE ${t.station}: observed ${t.observedFtMLLW ?? 'n/a'} ft MLLW at ${t.observedAt || 'n/a'}; predicted next: ${t.nextTides.map((p) => `${p.type} ${p.ft} ft at ${p.time}`).join(', ') || 'n/a'} (predictions exclude storm surge)`);
  lines.push(`PREDICTED FLOODING (ESTIMATE) [source: ${c.predictedFlooding.source}; status ${c.predictedFlooding.status}]: ${c.predictedFlooding.anchors.length ? c.predictedFlooding.anchors.map((a) => `~${a.levelFt} ft above normal high tide near ${a.gauge} (${a.basis}, ${a.time})`).join(' | ') : c.predictedFlooding.note}`);
  lines.push(`POWER OUTAGES ${stamp(c.powerOutages)}: ${c.powerOutages.byCounty.map((k) => `${k.county} ${k.out} customers out of ${k.served}`).join('; ') || 'n/a'}${c.powerOutages.topTowns.length ? `; towns: ${c.powerOutages.topTowns.map((t) => `${t.town} ${t.out}`).join(', ')}` : ''}`);
  lines.push(`MARINE ${stamp(c.marine)}: ${c.marine.stations.filter((s) => s.status === 'observed').map((s) => `${s.station}: waves ${s.waveHeightFt ?? 'n/a'} ft, water ${s.waterTempF ?? 'n/a'}F, wind ${s.windKt ?? 'n/a'} kt at ${s.observedAt}`).join(' | ') || 'no stations reporting'}`);
  lines.push(`AIRPORT WEATHER ${stamp(c.airports)}: ${c.airports.local.map((a) => `${a.airport}: ${a.category || 'n/a'}, wind ${a.windKt ?? 'n/a'}${a.gustKt ? `G${a.gustKt}` : ''} kt, ${a.tempF ?? 'n/a'}F at ${a.observedAt}`).join(' | ') || 'n/a'}`);
  lines.push(`TRAFFIC INCIDENTS ${stamp(c.trafficIncidents)}: ${c.trafficIncidents.count} in the three-county area${c.trafficIncidents.items.length ? `; e.g. ${c.trafficIncidents.items.slice(0, 5).map((i) => `${i.type}${i.road ? ` on ${i.road}` : i.from ? ` at ${i.from}` : ''}`).join(', ')}` : ''}`);
  lines.push(`RAIN RADAR: ${c.radar.note}`);
  return lines.join('\n').slice(0, 6000);
}

export function localConditionsPrompt() {
  if (Date.now() - snapshot.at > 2 * 60e3 && !snapshotInflight) {
    snapshotInflight = localConditions()
      .then((c) => {
        snapshot = { at: Date.now(), text: conditionsText(c) };
      })
      .catch(() => {})
      .finally(() => {
        snapshotInflight = null;
      });
  }
  const rules =
    'LOCAL CONDITIONS (Cape May County / South Jersey). When asked about local weather, flooding, tides, outages, traffic or marine conditions, answer ONLY from the snapshot below. ' +
    'Always name the source and its update time for each fact you use. Distinguish OBSERVED readings from FORECASTS and ESTIMATES. ' +
    'If a section says UNAVAILABLE, delayed, n/a or is missing, say that data is not available — never guess or fill in. ' +
    'Do not tell anyone they are safe or that an area is safe; you cannot see roads or homes. For protective actions point to the National Weather Service, Cape May County Office of Emergency Management, and 911 for emergencies. ' +
    'You are not an official source.';
  return snapshot.text
    ? `${rules}\n\n${snapshot.text}`
    : `${rules}\n\nThe local conditions snapshot is still loading. Say that local data is not available yet and to ask again in a minute.`;
}

// Warm the snapshot shortly after the server starts.
setTimeout(() => localConditionsPrompt(), 5000).unref?.();
