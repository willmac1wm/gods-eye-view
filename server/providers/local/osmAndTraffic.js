/**
 * OpenStreetMap-derived reference layers (cached to disk for 30 days, as
 * Cape Dispatch did) and TomTom traffic incidents.
 *
 * OSM data is volunteer-mapped and NOT authoritative; it is labelled that way.
 * Attribution: © OpenStreetMap contributors (ODbL).
 */
import { createSource, fetchJson, overpass } from './core.js';

const B = '(38.85,-75.45,39.75,-74.30)'; // south,west,north,east

const FACILITY_STYLE = {
  hospital: { color: '#ff4d6d', label: 'Hospital' },
  ems: { color: '#ff9f1a', label: 'EMS station' },
  fire: { color: '#ff3b3b', label: 'Fire station' },
  police: { color: '#4c8dff', label: 'Police' },
  helipad: { color: '#c77dff', label: 'Hospital helipad' },
};

function facilityKind(t) {
  if (t.amenity === 'hospital') return 'hospital';
  if (t.emergency === 'ambulance_station') return 'ems';
  if (t.amenity === 'fire_station') return 'fire';
  if (t.amenity === 'police') return 'police';
  if (t.aeroway === 'helipad') return 'helipad';
  return null;
}

export const facilities = createSource({
  name: 'emergency-facilities',
  source: {
    name: 'OpenStreetMap (volunteer-mapped, not authoritative)',
    url: 'https://www.openstreetmap.org/copyright',
    license: '© OpenStreetMap contributors (ODbL)',
  },
  ttlMs: 30 * 24 * 3600e3,
  staleAfterMs: 60 * 24 * 3600e3,
  diskName: 'emergency-facilities',
  async load() {
    const d = await overpass(
      `[out:json][timeout:60];(nwr["amenity"="hospital"]${B};nwr["amenity"="fire_station"]${B};` +
        `nwr["amenity"="police"]${B};nwr["emergency"="ambulance_station"]${B};nwr["aeroway"="helipad"]${B};);out center tags;`,
    );
    const features = [];
    for (const el of d.elements || []) {
      const t = el.tags || {};
      const kind = facilityKind(t);
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!kind || lat == null || lon == null) continue;
      const name = t.name || t.official_name || FACILITY_STYLE[kind].label;
      // Keep only helipads that belong to hospitals / EMS (as Cape Dispatch did).
      if (kind === 'helipad' && !/hospital|medical|regional|health|atlanticare|inspira|medevac|ems/i.test(`${name} ${t.operator || ''}`))
        continue;
      const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
      features.push({
        id: `osm:${el.type}/${el.id}`,
        kind: `facility-${kind}`,
        facilityType: FACILITY_STYLE[kind].label,
        geometry: { type: 'Point', lat, lon },
        title: name,
        address: [street, t['addr:city']].filter(Boolean).join(', ') || null,
        phone: t.phone || t['contact:phone'] || null,
        website: t.website || t['contact:website'] || null,
        operator: t.operator || null,
        emergencyDepartment: kind === 'hospital' ? (t.emergency === 'yes' ? 'yes' : t.emergency === 'no' ? 'no' : null) : null,
        status: 'reference',
        observedAt: null,
        color: FACILITY_STYLE[kind].color,
        label: name,
        link: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      });
    }
    if (!features.length) throw new Error('Overpass returned no facilities');
    const counts = {};
    for (const f of features) counts[f.facilityType] = (counts[f.facilityType] || 0) + 1;
    return {
      features,
      summary: { counts },
      note: 'Shelters are not included: no open shelter dataset was found for the county. Check Cape May County OEM for open shelters.',
    };
  },
});

const SITE_MILITARY = 'airfield|base|naval_base|range|training_area';

export const militaryAreas = createSource({
  name: 'military-areas',
  source: {
    name: 'OpenStreetMap (volunteer-mapped, not authoritative)',
    url: 'https://www.openstreetmap.org/copyright',
    license: '© OpenStreetMap contributors (ODbL)',
  },
  ttlMs: 30 * 24 * 3600e3,
  staleAfterMs: 60 * 24 * 3600e3,
  diskName: 'military-areas',
  async load() {
    const d = await overpass(
      `[out:json][timeout:60];(way["landuse"="military"]${B};rel["landuse"="military"]${B};` +
        `way["military"~"^(${SITE_MILITARY})$"]${B};rel["military"~"^(${SITE_MILITARY})$"]${B};);out tags geom;`,
    );
    const features = [];
    for (const el of d.elements || []) {
      const t = el.tags || {};
      if (t.building) continue;
      const name = (t.name || t.official_name || '').trim();
      // Same rules Cape Dispatch used: named site-level areas only, and the
      // two sites the owner asked to keep off the map stay hidden.
      if (!name || /eci fairview|nassau sigint/i.test(name)) continue;
      const rings = [];
      if (el.type === 'way' && el.geometry) rings.push(el.geometry.map((p) => [p.lon, p.lat]));
      for (const m of el.members || [])
        if (m.role === 'outer' && m.geometry) rings.push(m.geometry.map((p) => [p.lon, p.lat]));
      if (!rings.length) continue;
      const blob = `${name} ${t.operator || ''}`.toLowerCase();
      const uscg = /coast guard|uscg/.test(blob);
      features.push({
        id: `osm:${el.type}/${el.id}`,
        kind: 'military-area',
        geometry: { type: 'Polygon', rings },
        title: name,
        operator: t.operator || null,
        branch: uscg ? 'US Coast Guard' : 'Military',
        status: 'reference',
        observedAt: null,
        color: uscg ? '#ff9f1a' : '#9aa5b1',
        label: name,
        link: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      });
    }
    if (!features.length) throw new Error('Overpass returned no areas');
    return { features };
  },
});

// TomTom Traffic Incident Details v5. bbox area is capped (10,000 km²), so
// the three counties are asked for in two halves.
const INCIDENT_BOXES = ['-75.45,38.85,-74.30,39.30', '-75.45,39.30,-74.30,39.75'];
const ICON = {
  0: 'Unknown incident',
  1: 'Crash',
  2: 'Fog',
  3: 'Dangerous conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Traffic jam',
  7: 'Lane closed',
  8: 'Road closed',
  9: 'Road works',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken-down vehicle',
};
const ICON_COLOR = { 1: '#ff3b3b', 8: '#ff3b3b', 7: '#ff9f1a', 9: '#ffd43b', 11: '#4c8dff', 6: '#ff9f1a' };
const FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,lastReportTime}}}';

export const trafficIncidents = createSource({
  name: 'traffic-incidents',
  source: {
    name: 'TomTom Traffic Incidents',
    url: 'https://www.tomtom.com/traffic-index/',
    license: '© TomTom',
  },
  ttlMs: 3 * 60e3,
  staleAfterMs: 20 * 60e3,
  async load() {
    const key = String(process.env.TOMTOM_API_KEY || '').trim();
    if (!key) return { status: 'unavailable', note: 'TomTom key not configured', features: [] };
    const features = [];
    const seen = new Set();
    for (const bbox of INCIDENT_BOXES) {
      const url =
        `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${key}&bbox=${bbox}` +
        `&fields=${encodeURIComponent(FIELDS)}&language=en-US&timeValidityFilter=present`;
      const d = await fetchJson(url);
      for (const inc of d.incidents || []) {
        const p = inc.properties || {};
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const coords = inc.geometry?.type === 'Point' ? [inc.geometry.coordinates] : inc.geometry?.coordinates || [];
        const mid = coords[Math.floor(coords.length / 2)];
        if (!mid) continue;
        // Plain congestion is already shown by the traffic-flow layer.
        if (p.iconCategory === 6) continue;
        const type = ICON[p.iconCategory] || 'Incident';
        const road = (p.roadNumbers || []).join(', ');
        features.push({
          id: `tomtom:${p.id}`,
          kind: 'traffic-incident',
          geometry: { type: 'Point', lat: mid[1], lon: mid[0] },
          line: coords.length > 1 ? coords : null,
          title: type,
          incidentType: type,
          description: (p.events || []).map((e) => e.description).filter(Boolean).join('; ') || null,
          road: road || null,
          from: p.from || null,
          to: p.to || null,
          delaySeconds: p.delay ?? null,
          startTime: p.startTime || null,
          endTime: p.endTime || null,
          status: 'reported',
          observedAt: p.lastReportTime || p.startTime || null,
          color: ICON_COLOR[p.iconCategory] || '#ffd43b',
          label: `${type}${road ? ` · ${road}` : p.from ? ` · ${p.from}` : ''}`,
        });
      }
    }
    return { features, summary: { count: features.length } };
  },
});
