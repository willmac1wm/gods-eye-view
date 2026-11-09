/**
 * Official National Weather Service alerts for Cape May County and nearby
 * South Jersey land and marine zones (api.weather.gov, public domain).
 *
 * Alerts are found by asking NWS which alerts cover a set of reference points
 * (towns, Delaware Bay and the coastal waters), then de-duplicated by id.
 * Alerts without their own polygon get their forecast-zone outlines from
 * /zones (cached a day). Expired, cancelled, test and exercise messages are
 * dropped so nothing non-actionable is shown as a live warning.
 */
import { createSource, fetchJson } from './core.js';

const POINTS = [
  ['Cape May', 38.935, -74.906],
  ['Wildwood', 38.99, -74.82],
  ['Cape May Court House', 39.083, -74.822],
  ['Sea Isle City', 39.153, -74.693],
  ['Ocean City', 39.277, -74.575],
  ['Atlantic City', 39.364, -74.423],
  ['Millville', 39.402, -75.039],
  ['Delaware Bay', 39.02, -75.05],
  ['Coastal waters off Cape May', 38.86, -74.7],
  ['Coastal waters off Atlantic City', 39.3, -74.3],
];

const zoneCache = new Map(); // url -> { at, geometry, name }
const ZONE_TTL = 24 * 3600e3;

export function alertColor(props) {
  const event = String(props?.event || '').toLowerCase();
  if (/warning/.test(event)) return props.severity === 'Extreme' ? '#ff00ff' : '#ff3b3b';
  if (/watch/.test(event)) return '#ff9f1a';
  if (/advisory/.test(event)) return '#ffd43b';
  return '#4cc9f0'; // statements, outlooks
}

export function alertRank(props) {
  const event = String(props?.event || '').toLowerCase();
  const base = /warning/.test(event) ? 300 : /watch/.test(event) ? 200 : /advisory/.test(event) ? 100 : 0;
  const sev = { Extreme: 40, Severe: 30, Moderate: 20, Minor: 10 }[props?.severity] || 0;
  return base + sev;
}

async function zoneGeometry(url) {
  const hit = zoneCache.get(url);
  if (hit && Date.now() - hit.at < ZONE_TTL) return hit;
  const zone = await fetchJson(url, { headers: { Accept: 'application/geo+json' } });
  const entry = { at: Date.now(), geometry: zone.geometry, name: zone.properties?.name };
  zoneCache.set(url, entry);
  return entry;
}

/** GeoJSON Polygon/MultiPolygon -> array of outer rings [[lon,lat],...]. */
export function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]);
  return [];
}

function thin(ring, max = 300) {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out = ring.filter((_, i) => i % step === 0);
  out.push(ring[ring.length - 1]);
  return out;
}

async function load() {
  const byId = new Map();
  const failures = [];
  for (const [label, lat, lon] of POINTS) {
    try {
      const fc = await fetchJson(
        `https://api.weather.gov/alerts/active?point=${lat},${lon}`,
        { headers: { Accept: 'application/geo+json' } },
      );
      for (const f of fc.features || []) {
        const prev = byId.get(f.id);
        if (prev) prev.points.add(label);
        else byId.set(f.id, { feature: f, points: new Set([label]) });
      }
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }
  if (failures.length === POINTS.length) throw new Error(failures[0]);

  const now = Date.now();
  const features = [];
  for (const { feature, points } of byId.values()) {
    const p = feature.properties || {};
    if (p.status !== 'Actual') continue; // tests and exercises are not alerts
    if (p.messageType === 'Cancel') continue;
    const ends = Date.parse(p.ends || p.expires || '');
    if (Number.isFinite(ends) && ends < now) continue;

    let rings = outerRings(feature.geometry);
    let zoneNames = [];
    if (!rings.length && Array.isArray(p.affectedZones)) {
      for (const url of p.affectedZones.slice(0, 40)) {
        try {
          const zone = await zoneGeometry(url);
          rings.push(...outerRings(zone.geometry));
          if (zone.name) zoneNames.push(zone.name);
        } catch {
          /* an outline we cannot fetch is simply not drawn */
        }
      }
    }
    rings = rings.map((r) => thin(r));
    const color = alertColor(p);
    features.push({
      id: `nws:${feature.id}`,
      kind: 'alert',
      geometry: rings.length ? { type: 'Polygon', rings } : null,
      title: p.event,
      label: p.event,
      color,
      rank: alertRank(p),
      status: 'official',
      observedAt: p.sent || null,
      headline: p.headline || null,
      severity: p.severity || null,
      urgency: p.urgency || null,
      certainty: p.certainty || null,
      sender: p.senderName || 'National Weather Service',
      areaDesc: p.areaDesc || zoneNames.join('; ') || null,
      effective: p.effective || p.onset || null,
      expires: p.ends || p.expires || null,
      messageType: p.messageType || null,
      description: p.description || null,
      instruction: p.instruction || null,
      matchedPlaces: [...points],
      link: typeof feature.id === 'string' && feature.id.startsWith('http') ? feature.id : null,
    });
  }
  features.sort((a, b) => b.rank - a.rank || String(a.expires).localeCompare(String(b.expires)));
  const top = features[0];
  return {
    features,
    note: failures.length ? `Some areas could not be checked: ${failures.join('; ')}` : null,
    summary: {
      count: features.length,
      warnings: features.filter((f) => /warning/i.test(f.title)).length,
      watches: features.filter((f) => /watch/i.test(f.title)).length,
      advisories: features.filter((f) => /advisory/i.test(f.title)).length,
      top: top ? { title: top.title, color: top.color, expires: top.expires, id: top.id } : null,
    },
  };
}

export const nwsAlerts = createSource({
  name: 'nws-alerts',
  source: { name: 'National Weather Service (api.weather.gov)', url: 'https://www.weather.gov/phi/', license: 'Public domain (US Government)' },
  ttlMs: 2 * 60e3,
  staleAfterMs: 15 * 60e3,
  load,
});
