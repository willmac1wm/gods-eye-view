/**
 * What the county event log (eventLog.js) reads, and how each feed becomes
 * a list of observations the log can compare from one sweep to the next.
 *
 * Every source here is keyless and public:
 *   - the county envelopes the Local panel already serves (Fire Wire scanner
 *     calls, traffic incidents, approved community reports, NOAA gauges, NWS
 *     alerts, Atlantic City Electric outages), handed in by index.js;
 *   - adsb.lol /v2/mil (military-flagged ADS-B), one request per sweep;
 *   - NOAA NHC CurrentStorms.json, at most every 15 minutes;
 *   - FAA NAS Status (airport ground stops and delays), one request per sweep.
 *
 * A fetcher never throws: a failure comes back as { ok: false } so the log
 * can leave that source's items alone instead of declaring them cleared.
 *
 * Wording rules (civilian clarity): plain English, Eastern times, the
 * source's own words for what it reports, nothing stated as confirmed that
 * the source does not confirm.
 */
import crypto from 'node:crypto';
import { milesBetween } from './watchList.js';
import { parseCycloneStatus } from '../cyclones.js';
import { readResponseTextCapped } from '../common/http.js';
import {
  FAA_STATUS_LOCAL_AIRPORTS,
  parseNasStatusXml,
} from '../../../src/layers/faaStatus/records.js';

export { milesBetween };

// ------------------------------------------------------------------ places

export const CAPE_MAY = Object.freeze({ lat: 38.9351, lon: -74.906 });

/** The county area where a Coast Guard aircraft is worth an event. */
export const COUNTY_AREA = Object.freeze({
  south: 38.8,
  north: 39.4,
  west: -75.25,
  east: -74.45,
});

export const inCountyArea = (p) =>
  !!p &&
  p.lat >= COUNTY_AREA.south &&
  p.lat <= COUNTY_AREA.north &&
  p.lon >= COUNTY_AREA.west &&
  p.lon <= COUNTY_AREA.east;

/** Town centres, for "over North Wildwood" and report places. */
export const COUNTY_TOWNS = Object.freeze([
  { name: 'Cape May', lat: 38.9351, lon: -74.906 },
  { name: 'West Cape May', lat: 38.9387, lon: -74.9418 },
  { name: 'Cape May Point', lat: 38.9373, lon: -74.9663 },
  { name: 'Villas (Lower Twp)', lat: 39.0287, lon: -74.9385 },
  { name: 'Wildwood', lat: 38.9918, lon: -74.8149 },
  { name: 'North Wildwood', lat: 39.0001, lon: -74.7993 },
  { name: 'Wildwood Crest', lat: 38.9748, lon: -74.8335 },
  { name: 'Rio Grande', lat: 39.0145, lon: -74.8818 },
  { name: 'Cape May Court House', lat: 39.0826, lon: -74.8238 },
  { name: 'Stone Harbor', lat: 39.0526, lon: -74.7579 },
  { name: 'Avalon', lat: 39.1012, lon: -74.7177 },
  { name: 'Sea Isle City', lat: 39.1534, lon: -74.6929 },
  { name: 'Strathmere', lat: 39.1965, lon: -74.6571 },
  { name: 'Ocean City', lat: 39.2776, lon: -74.5746 },
  { name: 'Marmora (Upper Twp)', lat: 39.2582, lon: -74.6457 },
  { name: 'Woodbine', lat: 39.2418, lon: -74.8152 },
  { name: 'Dennis Twp', lat: 39.1932, lon: -74.8249 },
]);

/** Airports used to place a VIP aircraft. Coordinates are the airport refs. */
export const VIP_AIRPORTS = Object.freeze([
  { icao: 'KADW', name: 'Joint Base Andrews', lat: 38.8108, lon: -76.8669 },
  { icao: 'KDCA', name: 'Reagan National', lat: 38.8521, lon: -77.0377 },
  { icao: 'KIAD', name: 'Dulles Intl', lat: 38.9445, lon: -77.4558 },
  { icao: 'KBWI', name: 'BWI Marshall', lat: 39.1754, lon: -76.6683 },
  { icao: 'KPHL', name: 'Philadelphia Intl', lat: 39.8719, lon: -75.2411 },
  { icao: 'KACY', name: 'Atlantic City Intl', lat: 39.4576, lon: -74.5772 },
  {
    icao: 'KWWD',
    name: 'Cape May County Airport',
    lat: 39.0085,
    lon: -74.9083,
  },
  { icao: 'KEWR', name: 'Newark Liberty Intl', lat: 40.6925, lon: -74.1687 },
  { icao: 'KJFK', name: 'JFK Intl', lat: 40.6398, lon: -73.7789 },
  { icao: 'KLGA', name: 'LaGuardia', lat: 40.7772, lon: -73.8726 },
  { icao: 'KDOV', name: 'Dover AFB', lat: 39.1295, lon: -75.466 },
  { icao: 'KMTN', name: 'Martin State', lat: 39.3257, lon: -76.4138 },
  { icao: 'KNHK', name: 'NAS Patuxent River', lat: 38.286, lon: -76.4118 },
]);

const NM_PER_MILE = 0.868976;
export const nmBetween = (a, b) => milesBetween(a, b) * NM_PER_MILE;

const rad = (d) => (d * Math.PI) / 180;

/** True bearing in degrees from a to b. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const POINTS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
export const compass8 = (deg) => POINTS_8[Math.round(deg / 45) % 8];
export const compass16 = (deg) => POINTS_16[Math.round(deg / 22.5) % 16];

const nearest = (list, p) => {
  let best = null;
  for (const item of list) {
    const miles = milesBetween(item, p);
    if (!best || miles < best.miles) best = { ...item, miles };
  }
  return best;
};

export const nearestTown = (p) => nearest(COUNTY_TOWNS, p);

/** "over North Wildwood" within 1.5 mi of a town centre, else "3 mi SE of Cape May". */
export function overTownText(p) {
  const town = nearestTown(p);
  if (town.miles <= 1.5) return { text: `over ${town.name}`, town: town.name };
  return {
    text: `${Math.round(town.miles)} mi ${compass8(bearing(town, p))} of ${town.name}`,
    town: town.name,
  };
}

/** A resident-facing town name for a point, or '' when it is not near one. */
export function townFor(p) {
  if (!p) return '';
  const town = nearestTown(p);
  return town.miles <= 3 ? town.name : '';
}

// ------------------------------------------------------------------ text

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const fmtInt = (n) => intFmt.format(Math.round(n));

const easternDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const easternClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
});
const easternWeekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

/** "10:00 PM" today (Eastern), "Thu 10:00 PM" on another day. */
export function easternTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const at = new Date(ms);
  const clock = easternClock.format(at);
  return easternDay.format(at) === easternDay.format(new Date(now))
    ? clock
    : `${easternWeekday.format(at)} ${clock}`;
}

/** "2 h 10 min", "45 min", "under 1 min", "1 d 3 h". */
export function durationText(ms) {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

export function milesText(miles) {
  return miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(1)} mi`;
}

const clip = (text, max = 140) => {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** "STRUCTURE FIRE" / "Structure Fire" -> "Structure fire". */
export const sentence = (text) => {
  const s = clip(text, 80);
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
};

/** Stable short hash for event ids. */
export const shortHash = (text) =>
  crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 10);

const timeOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

// ------------------------------------------------------------------ roads

const US_ROUTES = new Set(['9', '30', '40', '322']);

/**
 * Numbered roads named in free text, normalized so "Rt 47", "Route 47",
 * "NJ 47" and "State Highway 47" all read "Route 47"; "CR 626" and
 * "County Road 626" read "CR 626"; "GSP" and "Garden State Pkwy" read
 * "Garden State Pkwy". Route 9 in Cape May County is US 9.
 */
export function roadsIn(text) {
  const s = String(text || '');
  const out = new Set();
  if (
    /\bgarden\s+state\s+(?:pkwy|parkway|pky)\b|\bg\.?\s?s\.?\s?p\b\.?|\bthe\s+parkway\b/i.test(
      s,
    )
  )
    out.add('Garden State Pkwy');
  for (const m of s.matchAll(
    /\b(?:c\.?\s?r\.?|county\s+(?:road|route|rd|rte|rt))\s*[-#]?\s*(\d{3})\b/gi,
  ))
    out.add(`CR ${Number(m[1])}`);
  for (const m of s.matchAll(
    /\b(?:u\.?\s?s\.?)\s*(?:route|rte|rt|hwy|highway)?\s*[-#]?\s*(\d{1,3})\b/gi,
  ))
    if (US_ROUTES.has(String(Number(m[1])))) out.add(`US ${Number(m[1])}`);
  for (const m of s.matchAll(
    /\b(?:route|rte|rt|n\.?\s?j\.?|state\s+(?:highway|hwy|route|rte|rd)|highway|hwy)\s*[-#.]?\s*(\d{1,3})\b/gi,
  )) {
    const n = String(Number(m[1]));
    out.add(n === '9' ? 'US 9' : `Route ${n}`);
  }
  return [...out];
}

// ------------------------------------------------------------------ water

const WATER =
  /\b(rescue|water|swimmers?|swimming|drown\w*|boats?|vessels?|overdue|capsiz\w*|mayday|search\w*)\b/i;

/** Does a call or report read like a water emergency? */
export const isWaterEmergency = (text) => WATER.test(String(text || ''));

// ------------------------------------------------------------------ aircraft

const VIP_CALLSIGN = /^(?:AF1|AF2|SAM\d+|EXEC1F)$/;
/** Military designations for the ICAO types the VIP fleet flies. */
const VIP_TYPES = Object.freeze({
  VC25: 'VC-25A',
  B752: 'C-32A',
  B737: 'C-40',
  GLF5: 'C-37',
  GLF4: 'C-20',
});
/** ICAO type -> Coast Guard designation. */
export const USCG_TYPES = Object.freeze({
  H60: 'MH-60T',
  H65: 'MH-65',
  AS65: 'MH-65',
  C130: 'HC-130',
  C30J: 'HC-130J',
  C27J: 'HC-27J',
  CN35: 'HC-144',
});
/** Types only the Coast Guard flies among U.S. military aircraft. */
const USCG_ONLY_TYPES = new Set(['H65', 'AS65', 'CN35']);
const USCG_CALLSIGN = /^(?:C\d{4}|CG\d+\w*|COAST\w*)$/;

export const callsignOf = (ac) =>
  String(ac?.flight || '')
    .trim()
    .toUpperCase();

/** Where an aircraft is, from its live position or a recent last position. */
export function aircraftPoint(ac) {
  const lat = Number(ac?.lat);
  const lon = Number(ac?.lon);
  if (
    ac?.lat != null &&
    ac?.lon != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  )
    return { lat, lon };
  const last = ac?.lastPosition;
  if (
    last &&
    Number.isFinite(Number(last.lat)) &&
    Number.isFinite(Number(last.lon)) &&
    Number(last.seen_pos) <= 60
  )
    return { lat: Number(last.lat), lon: Number(last.lon) };
  return null;
}

// ADS-B alt_baro is pressure altitude (referenced to 29.92 inHg / 1013.25
// hPa). Below the transition altitude it must be read with a local
// altimeter setting, the way ATC displays Mode C: on a 30.40 day a
// helicopter hovering at 80 ft reports about -400.
const PA_FEET = 145442.16;
const PA_EXP = 0.190263;
const STD_HPA = 1013.25;
export const HPA_PER_INHG = 33.8639;
const sane = (hpa) => Number.isFinite(hpa) && hpa >= 940 && hpa <= 1070;

/** Indicated altitude (ft) for a pressure altitude read with an altimeter setting (hPa). */
export function indicatedAltitude(pressureAltFt, altimeterHpa) {
  if (!Number.isFinite(pressureAltFt)) return null;
  if (!sane(altimeterHpa)) return pressureAltFt;
  const p = STD_HPA * (1 - pressureAltFt / PA_FEET) ** (1 / PA_EXP);
  return PA_FEET * (1 - (p / altimeterHpa) ** PA_EXP);
}

/**
 * "FL350" at or above 18,000 ft (the U.S. transition altitude, where
 * pressure altitude is the flight level), else the altitude read with
 * `altimeterHpa` when given: "12,500 ft", or "below 100 ft".
 */
export function altitudeText(altBaro, altimeterHpa = null) {
  if (!Number.isFinite(altBaro)) return '';
  if (altBaro >= 18_000)
    return `FL${String(Math.round(altBaro / 100)).padStart(3, '0')}`;
  const ft = indicatedAltitude(altBaro, altimeterHpa);
  if (ft < 100) return 'below 100 ft';
  return `${fmtInt(Math.round(ft / 100) * 100)} ft`;
}

/** METAR altimeter settings from the airport-weather envelope, last 3 hours. */
export function altimeterStations(env, now = Date.now()) {
  const out = [];
  for (const f of env?.features || []) {
    const inHg = Number(f?.altimeterInHg);
    const at = timeOf(f?.observedAt);
    const p =
      f?.geometry?.type === 'Point' &&
      Number.isFinite(f.geometry.lat) &&
      Number.isFinite(f.geometry.lon)
        ? { lat: f.geometry.lat, lon: f.geometry.lon }
        : null;
    if (!p || !Number.isFinite(inHg) || !sane(inHg * HPA_PER_INHG)) continue;
    if (at === null || now - at > 3 * 3600_000 || at - now > 15 * 60_000)
      continue;
    out.push({
      icao: String(f.icao || '').toUpperCase(),
      ...p,
      inHg,
      hpa: inHg * HPA_PER_INHG,
    });
  }
  return out;
}

/**
 * The setting to read an aircraft's altitude with: the nearest METAR within
 * 60 nm, else the setting the crew report (nav_qnh), else none.
 */
export function altimeterFor(ac, p, stations = []) {
  let best = null;
  if (p)
    for (const s of stations) {
      const nm = milesBetween(s, p) * NM_PER_MILE;
      if (nm <= 60 && (!best || nm < best.nm)) best = { ...s, nm };
    }
  if (best) return { hpa: best.hpa, inHg: best.inHg, icao: best.icao };
  const qnh = Number(ac?.nav_qnh);
  if (ac?.nav_qnh != null && sane(qnh)) return { hpa: qnh, icao: null };
  return null;
}

/** "altitude for local pressure (KACY 30.40 inHg)", when a METAR was used. */
const altimeterNote = (alt, altBaro) =>
  alt?.icao && Number.isFinite(altBaro) && altBaro < 18_000
    ? `altitude for local pressure (${alt.icao} ${alt.inHg.toFixed(2)} inHg)`
    : '';

export function isVipAircraft(ac) {
  return ac?.t === 'VC25' || VIP_CALLSIGN.test(callsignOf(ac));
}

/** Air Force One / Two and the VC-25As: followed nationwide. */
const NATIONWIDE_CALLSIGN = /^(?:AF1|AF2|EXEC1F)$/;
export const isNationwideVip = (ac) =>
  ac?.t === 'VC25' || NATIONWIDE_CALLSIGN.test(callsignOf(ac));

/**
 * Other Special Air Mission (SAM) flights are routine (cabinet and
 * congressional travel), so they are followed only within this range of
 * Cape May: Andrews, the Washington airports, Philadelphia and New York.
 */
export const SAM_RANGE_NM = 150;

/** "82-8000" -> "28000", the tail the VC-25As are known by. */
const vcTail = (reg) => {
  const m = /^\d(\d)-(\d{4})$/.exec(String(reg || ''));
  return m ? `${m[1]}${m[2]}` : String(reg || '').trim();
};

/**
 * What to call a VIP aircraft. "AF1" only when the callsign is AF1; a
 * VC-25A under another callsign is "VC-25A 28000 (callsign SAM28000)".
 */
export function vipLabel(ac) {
  const flight = callsignOf(ac);
  if (flight === 'AF1' || flight === 'AF2') return flight;
  if (ac?.t === 'VC25') {
    const tail = vcTail(ac.r) || String(ac.hex || '').toUpperCase();
    return `VC-25A ${tail}${flight ? ` (callsign ${flight})` : ''}`;
  }
  const type = VIP_TYPES[ac?.t] || ac?.t || 'aircraft';
  if (flight) return `${flight} (${type})`;
  return `${type} ${ac?.r || String(ac?.hex || '').toUpperCase()}`;
}

/**
 * "near Joint Base Andrews (KADW)" when within 10 nm and below 5,000 ft;
 * otherwise "34 nm NE of KPHL at FL350"; far from every listed airport,
 * "at FL350 over 38.9°N 102.9°W".
 */
export function vipWhere(p, altBaro, altimeterHpa = null) {
  const port = nearest(VIP_AIRPORTS, p);
  const nm = port.miles * NM_PER_MILE;
  const alt = altitudeText(altBaro, altimeterHpa);
  const feet = indicatedAltitude(altBaro, altimeterHpa);
  if (nm <= 10 && Number.isFinite(feet) && feet < 5000)
    return {
      near: true,
      text: `near ${port.name} (${port.icao})`,
      place: `${port.name} (${port.icao})`,
    };
  if (nm > 250) {
    const ll = `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;
    return {
      near: false,
      far: true,
      text: `${alt ? `at ${alt} ` : ''}over ${ll}`,
      place: ll,
    };
  }
  const where = `${Math.max(1, Math.round(nm))} nm ${compass8(bearing(port, p))} of ${port.icao}`;
  return {
    near: false,
    text: `${where}${alt ? ` at ${alt}` : ''}`,
    place: where,
  };
}

/** A U.S.-registered ICAO 24-bit address (A00000-AFFFFF). */
const usAddress = (ac) => /^a[0-9a-f]{5}$/i.test(String(ac?.hex || ''));

/**
 * Coast Guard by callsign, or by a Coast Guard type with a 4-digit tail.
 * U.S. addresses only: the French Navy flies AS65 Dauphins and several air
 * forces fly CN-235s and C-130s.
 */
export function coastGuardType(ac) {
  if (!usAddress(ac)) return null;
  const flight = callsignOf(ac);
  const type = USCG_TYPES[ac?.t] || null;
  if (USCG_CALLSIGN.test(flight)) return type || 'aircraft';
  if (!type) return null;
  if (USCG_ONLY_TYPES.has(ac.t) || /^\d{4}$/.test(String(ac.r || '').trim()))
    return type;
  return null;
}

// ------------------------------------------------------------------ storms

/** Saffir-Simpson category from sustained wind in knots (hurricanes only). */
export function hurricaneCategory(windKt) {
  if (!Number.isFinite(windKt) || windKt < 64) return null;
  if (windKt <= 82) return 1;
  if (windKt <= 95) return 2;
  if (windKt <= 112) return 3;
  if (windKt <= 136) return 4;
  return 5;
}

const STORM_CLASS = Object.freeze({
  PC: { name: 'Potential Tropical Cyclone', rank: 0 },
  TD: { name: 'Tropical Depression', rank: 1 },
  STD: { name: 'Subtropical Depression', rank: 1 },
  TS: { name: 'Tropical Storm', rank: 2 },
  STS: { name: 'Subtropical Storm', rank: 2 },
  HU: { name: 'Hurricane', rank: 3 },
  PTC: { name: 'Post-tropical Cyclone', rank: -1 },
});

export const stormClassName = (code) => STORM_CLASS[code]?.name || code;
export const stormRank = (code) => STORM_CLASS[code]?.rank ?? 0;

// ------------------------------------------------------------------ fetchers

const ADSB_URL = 'https://api.adsb.lol/v2/mil';
const NHC_URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const FAA_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
const UA = 'CapeMayDispatch-EventLog/1.0 (+https://capemaydispatch.com)';

async function fetchCapped(fetchImpl, url, { maxBytes, timeoutMs, accept }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(url, {
    signal,
    redirect: 'error',
    headers: { Accept: accept, 'User-Agent': UA },
  });
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* nothing to release */
    }
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return readResponseTextCapped(response, maxBytes, signal);
}

/** adsb.lol military aircraft. One request, 12 s, 2 MB cap (the feed is ~90 KB). */
export async function fetchMilitary({
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  try {
    const body = JSON.parse(
      await fetchCapped(fetchImpl, ADSB_URL, {
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: 12_000,
        accept: 'application/json',
      }),
    );
    if (!Array.isArray(body?.ac)) throw new Error('no aircraft list');
    return { ok: true, at: now, aircraft: body.ac };
  } catch (error) {
    return { ok: false, at: now, error: error?.message, status: error?.status };
  }
}

/** NHC active storms, parsed by the cyclone layer's own validator. */
export async function fetchStorms({
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  try {
    const body = JSON.parse(
      await fetchCapped(fetchImpl, NHC_URL, {
        maxBytes: 256 * 1024,
        timeoutMs: 12_000,
        accept: 'application/json',
      }),
    );
    return { ok: true, at: now, storms: parseCycloneStatus(body, now) };
  } catch (error) {
    return { ok: false, at: now, error: error?.message };
  }
}

/** FAA NAS Status for ACY, PHL and EWR. */
export async function fetchFaa({ fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const parsed = parseNasStatusXml(
      await fetchCapped(fetchImpl, FAA_URL, {
        maxBytes: 1024 * 1024,
        timeoutMs: 12_000,
        accept: 'application/xml, text/xml',
      }),
    );
    return {
      ok: true,
      at: now,
      local: parsed.local,
      updateTimeMs: parsed.updateTimeMs,
    };
  } catch (error) {
    return { ok: false, at: now, error: error?.message };
  }
}

// ------------------------------------------------------------------ adapters
//
// Each adapter turns one source answer into
//   { active: [observation], hold?: Set<key>, gone?: Map<key, ctx>, ctx?: Map<key, ctx> }
// active  items present and worth an event now;
// hold    keys whose state cannot be judged this time (never cleared);
// gone    when given, the ONLY keys that may be cleared (the source said so);
// ctx     what the source still says about a key that is no longer active.
//
// An observation: { key, kind, layer, source, at, lat, lon, severity,
//   firstSightLimit, snap, text: {title, place, detail}, update(prev),
//   again(), meta } — snap is persisted and compared on the next sweep.

const pointOf = (f) =>
  f?.geometry?.type === 'Point' &&
  Number.isFinite(f.geometry.lat) &&
  Number.isFinite(f.geometry.lon)
    ? { lat: f.geometry.lat, lon: f.geometry.lon }
    : null;

const CALL_SEVERITY = {
  high: 'warn',
  medium: 'watch',
  low: 'info',
  routine: 'info',
};

export function callObservations(env) {
  const active = [];
  for (const f of env?.features || []) {
    const p = pointOf(f);
    if (!p || !f.id) continue;
    const id = String(f.id).replace(/^call:/, '');
    const type = String(f.title || 'Police, fire or EMS call');
    const place = String(f.municipality || f.location || '').trim();
    const location = String(f.location || '').trim();
    const blob = `${type} ${location} ${f.summary || ''}`;
    active.push({
      key: `call:firewire:${id}`,
      kind: 'call',
      layer: 'scanner-calls',
      source: 'Fire Wire scanner',
      at: timeOf(f.observedAt),
      ...p,
      severity: CALL_SEVERITY[f.priority] || 'watch',
      firstSightLimit: true,
      snap: { type, place },
      text: {
        title: sentence(type),
        place,
        detail: [
          location && location !== place ? location : '',
          clip(f.summary),
        ]
          .filter(Boolean)
          .join(' · '),
      },
      update: (prev) =>
        prev.type && prev.type.toLowerCase() !== type.toLowerCase()
          ? {
              title: `Now listed as ${sentence(type).toLowerCase()}`,
              place,
              detail: `Was ${sentence(prev.type).toLowerCase()}`,
            }
          : null,
      meta: {
        roads: roadsIn(blob),
        water: isWaterEmergency(blob),
      },
    });
  }
  return { active };
}

const TRAFFIC_SEVERITY = {
  'Road closed': 'warn',
  Crash: 'warn',
  Flooding: 'warn',
  'Road works': 'info',
};

export function trafficObservations(env) {
  const active = [];
  for (const f of env?.features || []) {
    const p = pointOf(f);
    if (!p || !f.id) continue;
    const id = String(f.id).replace(/^tomtom:/, '');
    const type = String(f.title || f.incidentType || 'Traffic incident');
    const roadText = [f.road, f.from, f.to].filter(Boolean).join(' ');
    const roads = roadsIn(roadText);
    const road = roads[0] || String(f.road || f.from || '').trim();
    const stretch = [f.from, f.to].filter(Boolean).join(' to ');
    active.push({
      key: `traffic:tomtom:${id}`,
      kind: 'traffic',
      layer: 'traffic-incidents',
      source: 'TomTom traffic',
      at: timeOf(f.startTime) ?? timeOf(f.observedAt),
      ...p,
      severity: TRAFFIC_SEVERITY[type] || 'watch',
      firstSightLimit: true,
      snap: { type, road },
      text: {
        title: type,
        place: road,
        detail: [stretch, clip(f.description)].filter(Boolean).join(' · '),
      },
      update: (prev) =>
        prev.type && prev.type !== type
          ? {
              title: `Now: ${type.toLowerCase()}`,
              place: road,
              detail: `Was ${String(prev.type).toLowerCase()}`,
            }
          : null,
      meta: {
        roads: roadsIn(`${roadText} ${f.description || ''}`),
        water: false,
      },
    });
  }
  return { active };
}

export function reportObservations(env) {
  const active = [];
  for (const f of env?.features || []) {
    const p = pointOf(f);
    if (!p || !f.id) continue;
    const category = String(f.title || '')
      .replace(/^Community report\s*·\s*/i, '')
      .trim();
    const verified = f.status === 'verified';
    const title =
      category && category !== 'other'
        ? `${sentence(category)} reported by a resident`
        : 'Report from a resident';
    const place = townFor(p);
    active.push({
      key: `report:${String(f.id).replace(/^report:/, '')}`,
      kind: 'report',
      layer: 'community-reports',
      source: 'Community report',
      at: timeOf(f.observedAt),
      ...p,
      severity: 'watch',
      firstSightLimit: true,
      snap: { title, place, verified },
      text: {
        title,
        place,
        detail: [clip(f.text), verified ? 'verified' : 'unverified']
          .filter(Boolean)
          .join(' · '),
      },
      update: (prev) =>
        verified && !prev.verified
          ? {
              title: 'Report verified by a moderator',
              place,
              detail: title,
            }
          : null,
      meta: {
        roads: roadsIn(f.text),
        water: isWaterEmergency(`${category} ${f.text || ''}`),
      },
    });
  }
  return { active };
}

const FLOOD = ['minor', 'moderate', 'major'];
const FLOOD_SEVERITY = { minor: 'watch', moderate: 'warn', major: 'danger' };
const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());

/** "Cape May Harbor at Cape May Harbor" -> "Cape May Harbor". */
export function gaugePlace(title) {
  const t = String(title || 'tide gauge')
    .replace(/^New Jersey Atlantic Coast at\s+/i, '')
    .trim();
  const m = /^(.+?) at (.+)$/.exec(t);
  return m && m[1].trim().toLowerCase() === m[2].trim().toLowerCase()
    ? m[1].trim()
    : t;
}

export function floodObservations(env, now = Date.now()) {
  const active = [];
  const gone = new Map();
  for (const f of env?.features || []) {
    if (f.kind !== 'flood-gauge' || !f.id) continue;
    const key = `flooding:${f.id}`;
    const p = pointOf(f);
    const place = gaugePlace(f.title);
    const worst = String(f.worstCategory || '');
    const unit = f.datum || 'ft';
    const reading = f.observed
      ? `${f.observed.value} ${unit} at ${easternTime(timeOf(f.observed.time), now)}`
      : '';
    if (!FLOOD.includes(worst)) {
      // Only a gauge that is reporting can say the water went back down.
      if (f.status === 'observed') gone.set(key, { place, reading });
      continue;
    }
    const observed = FLOOD.includes(String(f.observed?.category || ''));
    const forecastAt = timeOf(f.forecast?.time);
    const parts = [];
    if (f.observed)
      parts.push(
        `${f.observed.value} ${unit} observed at ${easternTime(timeOf(f.observed.time), now)}`,
      );
    if (f.forecast && FLOOD.includes(String(f.forecast.category)))
      parts.push(
        `forecast ${f.forecast.value} ${unit} (${f.forecast.category}) at ${easternTime(forecastAt, now)}`,
      );
    if (Number.isFinite(f.floodStages?.minor))
      parts.push(`minor flood stage ${f.floodStages.minor} ft`);
    const state = observed ? 'observed' : 'forecast';
    active.push({
      key,
      kind: 'flooding',
      layer: 'tide-gauges',
      source: 'NOAA water gauges',
      at: observed ? timeOf(f.observed?.time) : null,
      lat: p?.lat ?? null,
      lon: p?.lon ?? null,
      severity: FLOOD_SEVERITY[worst],
      snap: { cat: worst, observed, place, forecastAt },
      text: {
        title: `${cap(worst)} flooding ${state}`,
        place,
        detail: cap(parts.join(' · ')),
      },
      update: (prev) => {
        if (prev.cat !== worst) {
          const up = FLOOD.indexOf(worst) > FLOOD.indexOf(prev.cat);
          return {
            title: `Flooding ${up ? 'up' : 'down'} to ${worst} (${state})`,
            place,
            detail: cap(parts.join(' · ')),
          };
        }
        if (prev.observed !== observed)
          return {
            title: observed
              ? `${cap(worst)} flooding now observed`
              : `Flooding no longer observed; ${worst} still forecast`,
            place,
            detail: cap(parts.join(' · ')),
          };
        return null;
      },
      meta: { roads: [], water: false },
    });
  }
  return { active, gone };
}

const alertClass = (event) =>
  /warning/i.test(event)
    ? 'warning'
    : /watch/i.test(event)
      ? 'watch'
      : /advisory/i.test(event)
        ? 'advisory'
        : 'statement';

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
const DANGER_WARNINGS =
  /tornado|hurricane|storm surge|extreme wind|tsunami|flash flood emergency/i;

export function alertSeverity(event, severity) {
  const cls = alertClass(event);
  if (cls === 'warning')
    return severity === 'Extreme' || DANGER_WARNINGS.test(event)
      ? 'danger'
      : 'warn';
  if (cls === 'watch' || cls === 'advisory') return 'watch';
  return 'info';
}

export const alertTone = (event, severity) => {
  const s = alertSeverity(event, severity);
  return s === 'info' ? 'ok' : s;
};

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** NWS alerts, one item per event name (an update keeps the same item). */
export function alertObservations(env, now = Date.now()) {
  const byEvent = new Map();
  for (const f of env?.features || []) {
    const event = String(f.title || f.event || '').trim();
    if (!event) continue;
    const entry = byEvent.get(event) || {
      event,
      expires: null,
      sent: null,
      severity: null,
      places: new Set(),
    };
    const ends = timeOf(f.expires);
    if (ends !== null && (entry.expires === null || ends > entry.expires))
      entry.expires = ends;
    const sent = timeOf(f.observedAt);
    if (sent !== null && (entry.sent === null || sent < entry.sent))
      entry.sent = sent;
    if ((SEVERITY_RANK[f.severity] || 0) > (SEVERITY_RANK[entry.severity] || 0))
      entry.severity = f.severity;
    for (const place of f.matchedPlaces || []) entry.places.add(place);
    byEvent.set(event, entry);
  }
  const active = [];
  for (const a of byEvent.values()) {
    const until = a.expires ? `until ${easternTime(a.expires, now)}` : '';
    const place = [...a.places].slice(0, 3).join(', ');
    active.push({
      key: `alert:nws:${slug(a.event)}`,
      kind: 'alert',
      layer: 'nws-alerts',
      source: 'National Weather Service',
      at: a.sent,
      lat: null,
      lon: null,
      severity: alertSeverity(a.event, a.severity),
      snap: { event: a.event, expires: a.expires, severity: a.severity },
      text: {
        title: until ? `${a.event} ${until}` : `${a.event} in effect`,
        place,
        detail: [
          a.sent ? `Issued ${easternTime(a.sent, now)}` : '',
          a.severity ? `severity ${a.severity.toLowerCase()}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
      update: (prev) => {
        if (prev.severity !== a.severity && a.severity)
          return {
            title: `${a.event} now ${a.severity.toLowerCase()} severity`,
            place,
            detail: until ? cap(until) : '',
          };
        if (
          a.expires &&
          prev.expires &&
          Math.abs(a.expires - prev.expires) >= 60 * 60_000
        )
          return {
            title:
              a.expires > prev.expires
                ? `${a.event} extended ${until}`
                : `${a.event} now ends ${easternTime(a.expires, now)}`,
            place,
            detail: `Was until ${easternTime(prev.expires, now)}`,
          };
        return null;
      },
      again: () => ({
        title: until ? `${a.event} reissued ${until}` : `${a.event} reissued`,
        place,
        detail: a.sent ? `Issued ${easternTime(a.sent, now)}` : '',
      }),
      meta: { roads: [], water: false },
    });
  }
  // A partial answer (some NWS points failed) cannot prove an alert ended.
  const partial = /could not be checked/i.test(String(env?.note || ''));
  return { active, partial };
}

/** Atlantic City Electric customers out in Cape May County, by threshold band. */
export const OUTAGE_BANDS = [100, 500, 1000, 5000];
export const outageBand = (out) =>
  OUTAGE_BANDS.filter((threshold) => out >= threshold).length;
const OUTAGE_SEVERITY = ['info', 'watch', 'watch', 'warn', 'danger'];
export const OUTAGE_KEY = 'outage:ace:cape-may';

export function capeMayOutages(env) {
  const county = (env?.summary?.counties || []).find((c) =>
    /^cape may$/i.test(String(c.county || '').trim()),
  );
  if (!county) return null;
  const towns = (env.features || [])
    .filter((f) => /^cape may$/i.test(f.county) && f.customersOut > 0)
    .sort((a, b) => b.customersOut - a.customersOut);
  return {
    out: Number(county.out) || 0,
    served: Number(county.served) || null,
    towns: towns.slice(0, 3).map((f) => ({
      name: f.title,
      out: f.customersOut,
      point: pointOf(f),
    })),
  };
}

export function outageObservations(env) {
  const cm = capeMayOutages(env);
  if (!cm) return { active: [], hold: new Set([OUTAGE_KEY]) };
  const band = outageBand(cm.out);
  if (band === 0)
    return { active: [], gone: new Map([[OUTAGE_KEY, { out: cm.out }]]) };
  const top = cm.towns.map((t) => `${t.name} (${fmtInt(t.out)})`).join(', ');
  const point = cm.towns[0]?.point || null;
  const count = `${fmtInt(cm.out)} customer${cm.out === 1 ? '' : 's'}`;
  return {
    active: [
      {
        key: OUTAGE_KEY,
        kind: 'outage',
        layer: 'power-outages',
        source: 'Atlantic City Electric',
        at: null,
        lat: point?.lat ?? null,
        lon: point?.lon ?? null,
        severity: OUTAGE_SEVERITY[band],
        snap: { band, out: cm.out },
        text: {
          title: `Power out for ${count} in Cape May County`,
          place: 'Cape May County',
          detail: top ? `Most in ${top}` : '',
        },
        update: (prev) =>
          prev.band !== band
            ? {
                title: `Power outages ${band > prev.band ? 'rising' : 'easing'}: ${count} out in Cape May County`,
                place: 'Cape May County',
                detail: top ? `Most in ${top}` : '',
              }
            : null,
        meta: { roads: [], water: false },
      },
    ],
  };
}

const FAA_TITLES = {
  'ground-stop': (icao) => `Ground stop at ${icao}`,
  'ground-delay': (icao) => `Ground delay program at ${icao}`,
  'arrival-departure': (icao, ev) =>
    `${cap(String(ev.delayType || 'Arrival/departure').toLowerCase())} delays at ${icao}`,
};
const FAA_SEVERITY = {
  'ground-stop': 'warn',
  'ground-delay': 'watch',
  'arrival-departure': 'watch',
};
const FAA_WORDS = {
  WX: 'weather',
  VOL: 'volume',
  RWY: 'runway',
  EQUIP: 'equipment',
  'TM INITIATIVES': 'traffic management',
  MIT: 'miles-in-trail spacing',
  TSTMS: 'thunderstorms',
};

/** "WX:Thunderstorms" -> "weather, thunderstorms (FAA: WX:Thunderstorms)". */
export function faaReason(reason) {
  const raw = clip(reason, 100);
  if (!raw) return '';
  // "VOL:Volume" names the same thing twice: say it once.
  const plain = [
    ...new Set(
      raw
        .split(':')
        .map(
          (part) =>
            FAA_WORDS[part.trim().toUpperCase()] || part.trim().toLowerCase(),
        )
        .filter(Boolean),
    ),
  ].join(', ');
  return plain.toLowerCase() === raw.toLowerCase()
    ? raw
    : `${plain} (FAA: ${raw})`;
}

/**
 * How long the delays run, in the FAA's own words. A ground delay program
 * gives an average and a maximum; arrival/departure delays give a range
 * (the parser keeps the feed's Min in `avg`).
 */
export function faaDelayText(ev) {
  const low = clip(ev?.avg, 40);
  const high = clip(ev?.max, 40);
  if (ev?.category === 'ground-delay')
    return [low ? `average ${low}` : '', high ? `maximum ${high}` : '']
      .filter(Boolean)
      .join(', ');
  if (low && high) return low === high ? low : `${low} to ${high}`;
  return low || high;
}

export function faaObservations(faa) {
  const active = [];
  for (const ev of faa?.local || []) {
    const make = FAA_TITLES[ev.category];
    const airport = FAA_STATUS_LOCAL_AIRPORTS[ev.airport];
    if (!make || !airport) continue;
    const icao = `K${ev.airport}`;
    const delayType = ev.delayType ? `:${slug(ev.delayType)}` : '';
    const range = faaDelayText(ev);
    active.push({
      key: `airport:faa:${ev.airport}:${ev.category}${delayType}`,
      kind: 'airport',
      layer: 'faa-status',
      source: 'FAA NAS Status',
      at: Number.isFinite(ev.startMs) ? ev.startMs : null,
      lat: airport.lat,
      lon: airport.lon,
      severity: FAA_SEVERITY[ev.category],
      snap: { title: make(icao, ev), place: `${airport.name} (${icao})` },
      text: {
        title: make(icao, ev),
        place: `${airport.name} (${icao})`,
        detail: [
          faaReason(ev.reason),
          range,
          ev.trend ? `trend ${String(ev.trend).toLowerCase()}` : '',
          ev.endTime ? `until ${ev.endTime}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
      update: () => null,
      meta: { roads: [], water: false },
    });
  }
  return { active };
}

export function stormObservations(storms, now = Date.now()) {
  const active = [];
  for (const s of storms || []) {
    // Cape May County cares about the Atlantic basin only.
    if (s.basin !== 'AL') continue;
    const p = { lat: s.position.latitude, lon: s.position.longitude };
    const miles = milesBetween(CAPE_MAY, p);
    const cls = s.classification;
    const cat = cls === 'HU' ? hurricaneCategory(s.windKt) : null;
    const name = `${stormClassName(cls)} ${s.name}`;
    const wind = Number.isFinite(s.windKt) ? ` · ${s.windKt} kt` : '';
    const place = `${fmtInt(miles)} mi ${compass16(bearing(CAPE_MAY, p))} of Cape May`;
    const move = s.movement?.speedKt
      ? `moving ${compass16(s.movement.directionDegrees ?? 0)} at ${s.movement.speedKt} kt`
      : '';
    const detail = [
      `NHC advisory ${s.advisoryNumber} issued ${easternTime(timeOf(s.issuedAt), now)}`,
      move,
    ]
      .filter(Boolean)
      .join(' · ');
    const near = miles <= 1000;
    const severity =
      cls === 'HU'
        ? near
          ? cat >= 3
            ? 'danger'
            : 'warn'
          : 'watch'
        : near && (cls === 'TS' || cls === 'STS')
          ? 'watch'
          : 'info';
    active.push({
      key: `storm:nhc:${s.id}`,
      kind: 'storm',
      layer: 'weather-cyclones',
      source: 'National Hurricane Center',
      at: timeOf(s.issuedAt),
      ...p,
      severity,
      snap: { cls, cat, name: s.name, windKt: s.windKt, miles },
      text: {
        title: `${name}${cat ? ` (Category ${cat})` : ''}${wind}`,
        place,
        detail,
      },
      update: (prev) => {
        if (prev.cls === cls && prev.cat === cat) return null;
        // A hurricane advisory without a wind value says nothing about its category.
        if (
          prev.cls === 'HU' &&
          cls === 'HU' &&
          (!Number.isFinite(cat) || !Number.isFinite(prev.cat))
        )
          return null;
        const prevName = `${stormClassName(prev.cls)} ${prev.name}`;
        if (prev.cls === 'HU' && cls === 'HU')
          return {
            title: `Hurricane ${s.name} ${cat > prev.cat ? 'upgraded' : 'downgraded'} to Category ${cat}${wind}`,
            place,
            detail,
          };
        if (cls === 'PTC')
          return {
            title: `${prevName} is now a post-tropical cyclone${wind}`,
            place,
            detail,
          };
        const up = stormRank(cls) > stormRank(prev.cls);
        return {
          title: `${prevName} ${up ? 'upgraded' : 'downgraded'} to ${stormClassName(cls)}${prev.name === s.name ? '' : ` ${s.name}`}${cat ? ` (Category ${cat})` : ''}${wind}`,
          place,
          detail,
        };
      },
      meta: { roads: [], water: false },
    });
  }
  return { active };
}

/**
 * Notable military aircraft: VIP (national) and Coast Guard over the county.
 * ctx carries what the feed still says about an aircraft that is listed but
 * no longer active (on the ground, or out of the county area).
 */
export function aircraftObservations(aircraft, { stations = [] } = {}) {
  const active = [];
  const hold = new Set();
  const ctx = new Map();
  for (const ac of aircraft || []) {
    const hex = String(ac?.hex || '')
      .toLowerCase()
      .replace(/[^0-9a-f~]/g, '');
    if (!hex) continue;
    if (Number(ac.seen) > 120) continue; // not heard for two minutes
    const p = aircraftPoint(ac);
    const ground = ac.alt_baro === 'ground';
    const alt = Number.isFinite(ac.alt_baro) ? ac.alt_baro : null;
    const altimeter = altimeterFor(ac, p, stations);
    const altNote = altimeterNote(altimeter, alt);
    const flight = callsignOf(ac);
    if (isVipAircraft(ac)) {
      const key = `aircraft:vip:${hex}`;
      const label = vipLabel(ac);
      if (
        !isNationwideVip(ac) &&
        !(p && nmBetween(CAPE_MAY, p) <= SAM_RANGE_NM)
      ) {
        ctx.set(key, { outside: true, label, point: p });
        continue;
      }
      if (ground) {
        ctx.set(key, { ground: true, label, point: p });
      } else if (!p) {
        hold.add(key); // heard, but no position: cannot say where or if it landed
      } else {
        const where = vipWhere(p, alt, altimeter?.hpa);
        const sep = where.near || where.far ? ' ' : ', ';
        const title = `${label} airborne${sep}${where.text}`;
        active.push({
          key,
          kind: 'aircraft',
          layer: 'military',
          source: 'adsb.lol (ADS-B)',
          at: null,
          ...p,
          severity: 'info',
          snap: { label, vip: true, where: where.text },
          text: {
            title,
            place: where.place,
            detail: [
              VIP_TYPES[ac.t] ? `${VIP_TYPES[ac.t]} (${ac.t})` : ac.t,
              ac.r ? `tail ${ac.r}` : '',
              flight ? `callsign ${flight}` : '',
              Number.isFinite(ac.gs)
                ? `${Math.round(ac.gs)} kt ground speed`
                : '',
              altNote,
            ]
              .filter(Boolean)
              .join(' · '),
          },
          again: () => ({
            title: `${label} airborne again${sep}${where.text}`,
            place: where.place,
            detail: '',
          }),
          update: () => null,
          track: { ...p, t: null },
          nowText: title,
          meta: { roads: [], water: false, coastGuard: false },
        });
      }
      continue;
    }
    const cgType = coastGuardType(ac);
    if (!cgType) continue;
    const key = `aircraft:uscg:${hex}`;
    const label = `Coast Guard ${cgType}`;
    if (!p) {
      hold.add(key);
      continue;
    }
    if (ground || !inCountyArea(p)) {
      ctx.set(key, { ground, label, point: p, outside: !inCountyArea(p) });
      continue;
    }
    const over = overTownText(p);
    const altText = altitudeText(alt, altimeter?.hpa);
    active.push({
      key,
      kind: 'aircraft',
      layer: 'military',
      source: 'adsb.lol (ADS-B)',
      at: null,
      ...p,
      severity: 'info',
      snap: { label, vip: false, where: over.text },
      text: {
        title: `${label} ${over.text}${altText ? `, ${altText}` : ''}`,
        place: over.town,
        detail: [
          flight ? `callsign ${flight}` : '',
          ac.r ? `tail ${ac.r}` : '',
          Number.isFinite(ac.gs) ? `${Math.round(ac.gs)} kt ground speed` : '',
          altNote,
        ]
          .filter(Boolean)
          .join(' · '),
      },
      again: () => ({
        title: `${label} back ${over.text}${altText ? `, ${altText}` : ''}`,
        place: over.town,
        detail: flight ? `callsign ${flight}` : '',
      }),
      update: () => null,
      track: { ...p, t: null },
      nowText: `${label} ${over.text}${altText ? `, ${altText}` : ''}`,
      meta: { roads: [], water: false, coastGuard: true },
    });
  }
  return { active, hold, ctx };
}
