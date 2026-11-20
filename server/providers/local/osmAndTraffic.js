/**
 * OpenStreetMap-derived reference layers (cached to disk for 30 days, as
 * Cape Dispatch did) and TomTom traffic incidents.
 *
 * OSM data is volunteer-mapped and NOT authoritative; it is labelled that way.
 * Attribution: © OpenStreetMap contributors (ODbL).
 */
import { createSource, fetchJson, fetchText, overpass } from './core.js';
import { firewireBases, normalizeFirewireIncidents } from '../scanner.js';

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
      if (
        kind === 'helipad' &&
        !/hospital|medical|regional|health|atlanticare|inspira|medevac|ems/i.test(
          `${name} ${t.operator || ''}`,
        )
      )
        continue;
      const street = [t['addr:housenumber'], t['addr:street']]
        .filter(Boolean)
        .join(' ');
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
        emergencyDepartment:
          kind === 'hospital'
            ? t.emergency === 'yes'
              ? 'yes'
              : t.emergency === 'no'
                ? 'no'
                : null
            : null,
        status: 'reference',
        observedAt: null,
        color: FACILITY_STYLE[kind].color,
        label: name,
        link: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      });
    }
    if (!features.length) throw new Error('Overpass returned no facilities');
    const counts = {};
    for (const f of features)
      counts[f.facilityType] = (counts[f.facilityType] || 0) + 1;
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
      if (el.type === 'way' && el.geometry)
        rings.push(el.geometry.map((p) => [p.lon, p.lat]));
      for (const m of el.members || [])
        if (m.role === 'outer' && m.geometry)
          rings.push(m.geometry.map((p) => [p.lon, p.lat]));
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
const INCIDENT_BOXES = [
  '-75.45,38.85,-74.30,39.30',
  '-75.45,39.30,-74.30,39.75',
];
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
const ICON_COLOR = {
  1: '#ff3b3b',
  8: '#ff3b3b',
  7: '#ff9f1a',
  9: '#ffd43b',
  11: '#4c8dff',
  6: '#ff9f1a',
};
const FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,lastReportTime}}}';

const TOMTOM_AUTH_COOLDOWN_MS = 60 * 60e3;
const TOMTOM_RATE_COOLDOWN_MS = 15 * 60e3;
const DELDOT_ADVISORY_URL = 'https://tmc.deldot.gov/json/advisory.json';
const NJT_BUS_ADVISORY_URL =
  'https://www.njtransit.com/rss/BusAdvisories_feed.xml';
let tomtomCircuitUntil = 0;
let tomtomCircuitKey = '';
let tomtomCircuitNote = '';

export function resetTomTomIncidentCircuit() {
  tomtomCircuitUntil = 0;
  tomtomCircuitKey = '';
  tomtomCircuitNote = '';
}

function classifyIncidentText(combined) {
  if (/\b(?:crash|accident|collision|mva|mvc|overturn)\b/i.test(combined)) {
    return { type: 'Crash', color: '#ff3b3b' };
  }
  if (
    /\b(?:road\s+closed|full\s+closure|bridge\s+closed|detour|blocked)\b/i.test(
      combined,
    )
  ) {
    return { type: 'Road closed', color: '#ff3b3b' };
  }
  if (/\b(?:flood|water\s+on\s+road|high\s+water)\b/i.test(combined)) {
    return { type: 'Flooding', color: '#4c8dff' };
  }
  if (
    /\b(?:lane\s+closed|lane\s+closure|right\s+lane|left\s+lane|wires\s+down|pole\s+down)\b/i.test(
      combined,
    )
  ) {
    return { type: 'Lane closed', color: '#ff9f1a' };
  }
  return { type: 'Road works', color: '#ffd43b' };
}

/**
 * DelDOT TMC advisories filtered strictly to the Delaware Bay / Sussex County /
 * Cape May–Lewes Ferry approach corridor (`lat <= 39.05` or `county.code === 'S'`),
 * keeping out northern Delaware (Wilmington / Newark / I-95) commuter roadwork.
 */
export function mapDeldotAdvisories(payload) {
  const features = [];
  const seen = new Set();
  for (const a of payload?.advisories || []) {
    const id = String(a?.id || '').trim();
    const lat = Number(a?.where?.lat ?? a?.where?.point?.coordinates?.[1]);
    const lon = Number(a?.where?.lon ?? a?.where?.point?.coordinates?.[0]);
    if (!id || seen.has(id) || !Number.isFinite(lat) || !Number.isFinite(lon))
      continue;
    const countyCode = String(a?.where?.county?.code || '')
      .trim()
      .toUpperCase();
    const inBayCorridor =
      lat >= 38.45 &&
      lat <= 39.05 &&
      lon >= -75.55 &&
      lon <= -74.3 &&
      (countyCode === '' || countyCode === 'S');
    if (!inBayCorridor) continue;
    seen.add(id);
    const rawLocation = String(a?.where?.location || '').trim();
    const [headPart, ...restParts] = rawLocation.split(':');
    const detailText = restParts.join(':').trim();
    const rawType = String(a?.type?.name || '').toLowerCase();
    const { type, color } = classifyIncidentText(`${rawType} ${rawLocation}`);
    const road = headPart ? headPart.slice(0, 80) : null;
    const city = String(
      a?.where?.address?.city || a?.where?.county?.name || '',
    ).trim();
    const desc = [detailText || rawLocation, a?.impact]
      .filter(Boolean)
      .join(' — ');
    features.push({
      id: `deldot:${id}`,
      kind: 'traffic-incident',
      geometry: { type: 'Point', lat, lon },
      line: null,
      title: type,
      incidentType: type,
      description: desc || null,
      road: road || null,
      from: city || null,
      to: null,
      delaySeconds: null,
      startTime: a?.timestamp || null,
      endTime: null,
      status: 'reported',
      observedAt: a?.timestamp || null,
      color,
      sourceName: 'DelDOT TMC',
      label: `${type}${road ? ` · ${road}` : city ? ` · ${city}` : ''}`,
    });
  }
  return features;
}

const NJT_TOWN_COORDS = [
  { re: /ocean city/i, name: 'Ocean City', lat: 39.2776, lon: -74.5746 },
  { re: /sea isle/i, name: 'Sea Isle City', lat: 39.1534, lon: -74.6929 },
  { re: /avalon/i, name: 'Avalon', lat: 39.1012, lon: -74.7177 },
  { re: /stone harbor/i, name: 'Stone Harbor', lat: 39.0526, lon: -74.7579 },
  {
    re: /court house/i,
    name: 'Cape May Court House',
    lat: 39.0826,
    lon: -74.8238,
  },
  { re: /rio grande/i, name: 'Rio Grande', lat: 39.0145, lon: -74.8818 },
  {
    re: /north wildwood/i,
    name: 'North Wildwood',
    lat: 39.0001,
    lon: -74.7993,
  },
  { re: /wildwood/i, name: 'Wildwood', lat: 38.9918, lon: -74.8149 },
  { re: /villas/i, name: 'Villas', lat: 39.0287, lon: -74.9385 },
  { re: /woodbine/i, name: 'Woodbine', lat: 39.2418, lon: -74.8152 },
  { re: /cape may/i, name: 'Cape May', lat: 38.9351, lon: -74.906 },
];
const NJT_COUNTY_RE =
  /\b(?:313|315|316|319|552)\b|cape may|wildwood|ocean city|sea isle|avalon|stone harbor|rio grande|court house/i;

export function mapNjtTrafficAdvisories(xml) {
  const features = [];
  const seen = new Set();
  const blocks = String(xml || '')
    .split(/<item[\s>]/i)
    .slice(1, 50);
  const tag = (b, name) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(b);
    return m
      ? m[1]
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<[^>]+>/g, '')
          .trim()
      : '';
  };
  for (const block of blocks) {
    const title = tag(block, 'title');
    const desc = tag(block, 'description');
    const blob = `${title} ${desc}`;
    if (!NJT_COUNTY_RE.test(blob)) continue;
    const town = NJT_TOWN_COORDS.find((t) => t.re.test(blob));
    if (!town) continue;
    const key = title.toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const pub = Date.parse(tag(block, 'pubDate'));
    if (Number.isFinite(pub) && Date.now() - pub > 48 * 3600e3) continue;
    const routeMatch = /\b(313|315|316|319|552)\b/.exec(blob);
    const road = routeMatch ? `NJ Transit Rt ${routeMatch[1]}` : town.name;
    const { type, color } = classifyIncidentText(blob);
    const iso = Number.isFinite(pub) ? new Date(pub).toISOString() : null;
    features.push({
      id: `njt:${Buffer.from(key).toString('hex').slice(0, 16)}`,
      kind: 'traffic-incident',
      geometry: { type: 'Point', lat: town.lat, lon: town.lon },
      line: null,
      title: type,
      incidentType: type,
      description: desc || title,
      road,
      from: town.name,
      to: null,
      delaySeconds: null,
      startTime: iso,
      endTime: null,
      status: 'reported',
      observedAt: iso,
      color,
      sourceName: 'NJ Transit Advisories',
      label: `${type} · ${road} (${town.name})`,
    });
  }
  return features;
}

const FIREWIRE_ROAD_RE =
  /\b(?:mva|mvc|motor vehicle|crash|accident|collision|overturn|road closed|lane closed|traffic hazard|wires down|pole down|flooded road|high water)\b/i;

export function mapFirewireTrafficIncidents(rawPayload) {
  const normalized = normalizeFirewireIncidents(rawPayload) || [];
  const features = [];
  for (const inc of normalized) {
    const blob = `${inc.type || ''} ${inc.location || ''} ${inc.summary || ''}`;
    if (!FIREWIRE_ROAD_RE.test(blob)) continue;
    if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lon)) continue;
    const { type, color } = classifyIncidentText(blob);
    const iso = new Date(inc.createdMs).toISOString();
    features.push({
      id: `fw-traffic:${inc.id}`,
      kind: 'traffic-incident',
      geometry: { type: 'Point', lat: inc.lat, lon: inc.lon },
      line: null,
      title: type,
      incidentType: type,
      description: inc.summary || inc.type,
      road: inc.location || inc.municipality || null,
      from: inc.municipality || null,
      to: null,
      delaySeconds: null,
      startTime: iso,
      endTime: null,
      status: 'reported',
      observedAt: iso,
      color,
      sourceName: 'Fire Wire Dispatch',
      label: `${type}${inc.location ? ` · ${inc.location}` : inc.municipality ? ` · ${inc.municipality}` : ''}`,
    });
  }
  return features;
}

/**
 * Multi-source traffic incident fusion & spatial corroboration.
 * Combines incidents from TomTom, DelDOT TMC, NJ Transit, and Fire Wire
 * radio dispatches; when two independent sources report an incident within
 * ~0.006° (~0.4 mi), fuses them into a single corroborated feature.
 */
export function fuseTrafficIncidents(...lists) {
  const fused = [];
  const near = (a, b) =>
    Math.abs((a.geometry?.lat ?? 0) - (b.geometry?.lat ?? 999)) <= 0.006 &&
    Math.abs((a.geometry?.lon ?? 0) - (b.geometry?.lon ?? 999)) <= 0.006;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item?.id) continue;
      const match = fused.find(
        (existing) =>
          existing.id !== item.id &&
          near(existing, item) &&
          (existing.sourceName || '') !== (item.sourceName || ''),
      );
      if (!match) {
        fused.push({
          ...item,
          corroboratedSources: [item.sourceName || 'Traffic feed'],
        });
        continue;
      }
      const src = item.sourceName || 'Secondary feed';
      if (!match.corroboratedSources.includes(src)) {
        match.corroboratedSources.push(src);
      }
      if (!match.description && item.description) {
        match.description = item.description;
      } else if (
        item.description &&
        match.description &&
        !match.description.includes('Corroborated by')
      ) {
        match.description = `${match.description} [Corroborated by ${match.corroboratedSources.join(' + ')}]`;
      }
    }
  }
  return fused;
}

async function fetchFirewireRoadFeatures() {
  for (const base of firewireBases()) {
    try {
      const payload = await fetchJson(`${base}/api/incidents?hours=12`, {
        timeoutMs: 5000,
      });
      return mapFirewireTrafficIncidents(payload);
    } catch {
      /* try next base */
    }
  }
  return [];
}

async function loadDeldotTrafficFallback(reasonNote) {
  const [deldotRes, njtRes, fwRes] = await Promise.allSettled([
    fetchJson(DELDOT_ADVISORY_URL, { timeoutMs: 10000 }).then(
      mapDeldotAdvisories,
    ),
    fetchText(NJT_BUS_ADVISORY_URL, { timeoutMs: 8000 }).then(
      mapNjtTrafficAdvisories,
    ),
    fetchFirewireRoadFeatures(),
  ]);
  if (
    deldotRes.status === 'rejected' &&
    njtRes.status === 'rejected' &&
    fwRes.status === 'rejected'
  ) {
    throw deldotRes.reason || new Error('All traffic fallback sources failed');
  }
  const deldotFeatures =
    deldotRes.status === 'fulfilled' ? deldotRes.value : [];
  const njtFeatures = njtRes.status === 'fulfilled' ? njtRes.value : [];
  const fwFeatures = fwRes.status === 'fulfilled' ? fwRes.value : [];
  const features = fuseTrafficIncidents(
    fwFeatures,
    njtFeatures,
    deldotFeatures,
  );
  return {
    status: 'live',
    note: `${reasonNote}; showing fused DelDOT TMC + NJ Transit + Fire Wire corridor advisories (${features.length})`,
    features,
    summary: { count: features.length },
  };
}

export const trafficIncidents = createSource({
  name: 'traffic-incidents',
  source: {
    name: 'TomTom Traffic · DelDOT TMC · NJ Transit · Fire Wire Fusion',
    url: 'https://www.tomtom.com/traffic-index/',
    license: '© TomTom · DelDOT TMC · NJ Transit · Fire Wire Public Advisories',
  },
  ttlMs: 15 * 60e3,
  staleAfterMs: 60 * 60e3,
  diskName: 'traffic-incidents',
  async load() {
    const key = String(process.env.TOMTOM_API_KEY || '').trim();
    if (!key) {
      try {
        return await loadDeldotTrafficFallback('TomTom key not configured');
      } catch {
        return {
          status: 'unavailable',
          note: 'TomTom key not configured',
          features: [],
        };
      }
    }
    const now = Date.now();
    if (key === tomtomCircuitKey && now < tomtomCircuitUntil) {
      try {
        return await loadDeldotTrafficFallback(tomtomCircuitNote);
      } catch {
        return {
          status: 'unavailable',
          note: tomtomCircuitNote,
          features: [],
        };
      }
    }
    const features = [];
    const seen = new Set();
    try {
      for (const bbox of INCIDENT_BOXES) {
        const url =
          `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}&bbox=${bbox}` +
          `&fields=${encodeURIComponent(FIELDS)}&language=en-US&timeValidityFilter=present`;
        const d = await fetchJson(url);
        for (const inc of d.incidents || []) {
          const p = inc.properties || {};
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          const coords =
            inc.geometry?.type === 'Point'
              ? [inc.geometry.coordinates]
              : inc.geometry?.coordinates || [];
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
            description:
              (p.events || [])
                .map((e) => e.description)
                .filter(Boolean)
                .join('; ') || null,
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
      resetTomTomIncidentCircuit();
      return { features, summary: { count: features.length } };
    } catch (error) {
      const msg = String(error?.message || error);
      if (/HTTP (401|403)\b/.test(msg)) {
        tomtomCircuitKey = key;
        tomtomCircuitUntil = Date.now() + TOMTOM_AUTH_COOLDOWN_MS;
        tomtomCircuitNote = `TomTom traffic paused (${msg}; backing off for 1 h)`;
        console.warn('[Local:traffic-incidents]', tomtomCircuitNote);
        try {
          return await loadDeldotTrafficFallback(tomtomCircuitNote);
        } catch {
          return {
            status: 'unavailable',
            note: tomtomCircuitNote,
            features: [],
          };
        }
      }
      if (/HTTP 429\b/.test(msg)) {
        tomtomCircuitKey = key;
        tomtomCircuitUntil = Date.now() + TOMTOM_RATE_COOLDOWN_MS;
        tomtomCircuitNote = `TomTom traffic rate limited (${msg}; backing off for 15 min)`;
        console.warn('[Local:traffic-incidents]', tomtomCircuitNote);
        try {
          return await loadDeldotTrafficFallback(tomtomCircuitNote);
        } catch {
          return {
            status: 'unavailable',
            note: tomtomCircuitNote,
            features: [],
          };
        }
      }
      throw error;
    }
  },
});
