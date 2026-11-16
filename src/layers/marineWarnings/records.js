import {
  MARINE_BBOX,
  MARINE_LOCAL_WATERWAYS,
  pointInMarineBox,
} from '../../region/mode.js';

/**
 * USCG Broadcast Notices to Mariners (BNM) — parsing + filtering for the
 * Marine Warnings layer.
 *
 * Source: USCG NAVCEN via the GovDelivery RSS feeds for Sector Delaware Bay
 * and District 5 (East). Free, keyless, U.S. public domain. The proxy
 * (`server/providers/marineWarnings.js`) extracts the raw RSS items; this
 * module turns them into display rows.
 *
 * KEY LIMITATION (v1, list-first): most warnings never get a map pin. ATON
 * notices usually give an aid name + LLNR and no position in the text, so
 * the layer shows every in-force warning in the panel and pins only the
 * ones with a parsed position. A future LLNR→position join against the
 * USCG Light List (or paid SeaLagom coordinates — see DATA_SOURCES.md)
 * would raise the pin rate; it is not built here.
 *
 * Severity is OUR heuristic — the source carries no severity field:
 *   high     SAFETY + HAZ OPS / RIGHT WHALE SLOW ZONE / DREDGING /
 *            MARINE EVENTS / BRIDGE
 *   moderate SAFETY + ATON when the aid is extinguished / missing /
 *            off-station / destroyed, and SAFETY + anything else
 *   low      SCHEDULED
 *   info     CANCELLATION (tombstone only — never displayed)
 */

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const HTML_ENTITIES = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  // GovDelivery encodes the BNM's typography as entities: the degree
  // sign and curly quotes carry the positions (`39&deg;49.068&rsquo;N`),
  // so they must decode or the position parser sees nothing.
  '&deg;': '°',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
  '&prime;': '′',
  '&Prime;': '″',
  '&ndash;': '–',
  '&mdash;': '—',
  '&hellip;': '…',
  '&times;': '×',
  '&middot;': '·',
  '&bull;': '•',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&sect;': '§',
  '&para;': '¶',
  '&laquo;': '«',
  '&raquo;': '»',
  '&dagger;': '†',
  '&Dagger;': '‡',
  '&permil;': '‰',
  '&ensp;': ' ',
  '&emsp;': ' ',
  '&thinsp;': ' ',
});

/**
 * Strip the GovDelivery description HTML (`<p>`, `<br />`, …) to plain
 * message text. Never throws: unparseable input yields ''.
 */
export function stripBnmHtml(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[A-Za-z]+;/g, (m) => HTML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) && n > 0 && n < 0x110000
        ? String.fromCodePoint(n)
        : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Uppercase, collapse punctuation/whitespace — for waterway matching. */
function normalizeAreaText(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

/** `SEC SDB BNM 0288-26` / `CGD-E BNM 0523-26` — originator + number. */
const BNM_REF_PATTERN = /(SEC SDB|CGD-E)\s+BNM\s+(\d+)-(\d+)/;

/**
 * Parse a BNM title: `CRITICALITY/AREA/DESCRIPTOR/SEC SDB BNM 0288-26`,
 * `CANCELLATION/SEC SDB BNM 0283-26`, `CANCELLATION - MULTIPLE/SEC SDB`,
 * `UPDATE/MANASQUAN RIVER /ATON/SEC SDB BNM 0221-26 UPDATE-1`.
 * Returns null when no BNM reference is present (multi-cancellations
 * carry none in the title — their targets come from the body).
 */
export function parseBnmTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') return null;
  const match = BNM_REF_PATTERN.exec(title);
  if (!match) return null;
  const segments = title
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const lastIndex = segments.length - 1;
  const criticality = segments[0] ?? null;
  const descriptor = segments.length >= 3 ? segments[lastIndex - 1] : null;
  const area =
    segments.length >= 4 ? segments.slice(1, lastIndex - 1).join(' / ') : null;
  const originator = match[1];
  const number = `${match[2]}-${match[3]}`;
  return {
    criticality,
    area,
    descriptor,
    originator,
    number,
    stableId: `${originator}:${number}`,
  };
}

/** Every BNM reference in a body (cancellation targets). */
export function findBnmReferences(text) {
  const refs = [];
  if (typeof text !== 'string') return refs;
  const pattern = new RegExp(BNM_REF_PATTERN, 'g');
  for (const match of text.matchAll(pattern)) {
    refs.push(`${match[1]}:${match[2]}-${match[3]}`);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Position parsing
// ---------------------------------------------------------------------------

function validLatLon(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function dmsToDecimal(degrees, minutes, seconds = 0) {
  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * All positions in a BNM body, in text order, de-duplicated. Formats seen
 * in the live feeds (verified 2026-11-16):
 *   `38-55.35 N 075-06.01 W`            degrees-decimal-minutes
 *   `39°49.068'N 75°23.334'W`           degree symbol, ' or ’ quote
 *   `38-58-44-298N, 076-14-29.420W`     degrees-minutes-seconds
 *   `40 DEGREES 21 MINUTES NORTH`      spelled-out (paired in order)
 *   `34-17N5 076-45W2`                 HAZOPS compact: trailing digit is
 *                                       tenths of a minute (34°17.5'N)
 * Returns [] when nothing parses; never throws.
 */
export function parseBnmPositions(text) {
  if (typeof text !== 'string' || text === '') return [];
  const found = []; // {index, lat, lon}

  const push = (index, lat, lon) => {
    if (validLatLon(lat, lon)) found.push({ index, lat, lon });
  };

  // Degrees-decimal-minutes: 38-55.35 N 075-06.01 W
  const dmPattern =
    /(\d{1,2})-(\d{2}(?:\.\d+)?)\s*([NS])\s+(\d{1,3})-(\d{2}(?:\.\d+)?)\s*([EW])/g;
  for (const m of text.matchAll(dmPattern)) {
    const latMin = Number(m[2]);
    const lonMin = Number(m[5]);
    if (latMin >= 60 || lonMin >= 60) continue;
    const lat = (Number(m[1]) + latMin / 60) * (m[3] === 'S' ? -1 : 1);
    const lon = (Number(m[4]) + lonMin / 60) * (m[6] === 'W' ? -1 : 1);
    push(m.index, lat, lon);
  }

  // Degree symbol: 39°49.068'N 75°23.334'W (quote may be ' ’ or ′)
  const degPattern =
    /(\d{1,2})°\s*(\d{2}(?:\.\d+)?)\s*['’′]\s*([NS])\s+(\d{1,3})°\s*(\d{2}(?:\.\d+)?)\s*['’′]\s*([EW])/g;
  for (const m of text.matchAll(degPattern)) {
    const latMin = Number(m[2]);
    const lonMin = Number(m[5]);
    if (latMin >= 60 || lonMin >= 60) continue;
    const lat = (Number(m[1]) + latMin / 60) * (m[3] === 'S' ? -1 : 1);
    const lon = (Number(m[4]) + lonMin / 60) * (m[6] === 'W' ? -1 : 1);
    push(m.index, lat, lon);
  }

  // Degrees-minutes-seconds: 38-58-44-298N, 076-14-29.420W
  // (seconds separator may be '-' or '.')
  const dmsPattern =
    /(\d{1,2})-(\d{2})-(\d{2})(?:[.-](\d+))?\s*([NS])\s*,?\s*(\d{1,3})-(\d{2})-(\d{2})(?:[.-](\d+))?\s*([EW])/g;
  for (const m of text.matchAll(dmsPattern)) {
    const latMin = Number(m[2]);
    // `44-298` means 44.298 seconds: the fraction is decimal seconds.
    const latSec = Number(m[3]) + (m[4] == null ? 0 : Number(`0.${m[4]}`));
    const lonMin = Number(m[7]);
    const lonSec = Number(m[8]) + (m[9] == null ? 0 : Number(`0.${m[9]}`));
    if (latMin >= 60 || lonMin >= 60) continue;
    const lat =
      dmsToDecimal(Number(m[1]), latMin, latSec) * (m[5] === 'S' ? -1 : 1);
    const lon =
      dmsToDecimal(Number(m[6]), lonMin, lonSec) * (m[10] === 'W' ? -1 : 1);
    push(m.index, lat, lon);
  }

  // HAZOPS compact: 34-17N5 076-45W2 — trailing digit = tenths of a minute.
  const compactPattern =
    /(\d{1,2})-(\d{2})([NS])(\d)\s+(\d{1,3})-(\d{2})([EW])(\d)/g;
  for (const m of text.matchAll(compactPattern)) {
    const latMin = Number(m[2]) + Number(m[4]) / 10;
    const lonMin = Number(m[6]) + Number(m[8]) / 10;
    if (latMin >= 60 || lonMin >= 60) continue;
    const lat = (Number(m[1]) + latMin / 60) * (m[3] === 'S' ? -1 : 1);
    const lon = (Number(m[5]) + lonMin / 60) * (m[7] === 'W' ? -1 : 1);
    push(m.index, lat, lon);
  }

  // Spelled-out: 40 DEGREES 21 MINUTES NORTH (optional SECONDS).
  // Lats and lons arrive in separate runs (e.g. a Right Whale Slow Zone
  // "BOUNDED BY" lists two lats then two lons) — pair them in order.
  const wordLatPattern =
    /(\d{1,2})\s+DEGREES?\s+(\d{1,2}(?:\.\d+)?)\s+MINUTES?(?:\s+(\d{1,2}(?:\.\d+)?)\s+SECONDS?)?\s+(NORTH|SOUTH)/gi;
  const wordLonPattern =
    /(\d{1,3})\s+DEGREES?\s+(\d{1,2}(?:\.\d+)?)\s+MINUTES?(?:\s+(\d{1,2}(?:\.\d+)?)\s+SECONDS?)?\s+(EAST|WEST)/gi;
  const wordLats = [];
  const wordLons = [];
  for (const m of text.matchAll(wordLatPattern)) {
    const minutes = Number(m[2]);
    if (minutes >= 60) continue;
    const seconds = m[3] == null ? 0 : Number(m[3]);
    wordLats.push({
      index: m.index,
      value:
        dmsToDecimal(Number(m[1]), minutes, seconds) *
        (m[4].toUpperCase() === 'SOUTH' ? -1 : 1),
    });
  }
  for (const m of text.matchAll(wordLonPattern)) {
    const minutes = Number(m[2]);
    if (minutes >= 60) continue;
    const seconds = m[3] == null ? 0 : Number(m[3]);
    wordLons.push({
      index: m.index,
      value:
        dmsToDecimal(Number(m[1]), minutes, seconds) *
        (m[4].toUpperCase() === 'WEST' ? -1 : 1),
    });
  }
  const pairs = Math.min(wordLats.length, wordLons.length);
  for (let i = 0; i < pairs; i++) {
    push(wordLats[i].index, wordLats[i].value, wordLons[i].value);
  }

  found.sort((a, b) => a.index - b.index);
  const points = [];
  for (const { lat, lon } of found) {
    const last = points[points.length - 1];
    if (
      last &&
      Math.abs(last.lat - lat) < 1e-9 &&
      Math.abs(last.lon - lon) < 1e-9
    )
      continue;
    points.push({ lat, lon });
  }
  return points;
}

/**
 * The pin position for parsed points: the centroid of a polygon, else the
 * first parsed position. A polygon is an explicit `BEGINNING AT …
 * THEN TO POINT OF BEGINNING` area, or any body with ≥3 parsed positions
 * (a HAZOPS "AREA BOUND BY" vertex list, or a multi-position notice) —
 * three or more positions describe an area, not a point, so the pin is
 * the area centroid. Returns null when there are no points.
 */
export function positionFromPoints(text, points) {
  if (!Array.isArray(points) || !points.length) return null;
  const isPolygon =
    (/BEGINNING AT/i.test(text) && /POINT OF BEGINNING/i.test(text)) ||
    points.length >= 3;
  if (isPolygon) {
    let lat = 0;
    let lon = 0;
    for (const point of points) {
      lat += point.lat;
      lon += point.lon;
    }
    return {
      lat: lat / points.length,
      lon: lon / points.length,
      polygon: true,
      vertices: points.length,
    };
  }
  return {
    lat: points[0].lat,
    lon: points[0].lon,
    polygon: false,
    vertices: points.length,
  };
}

/** The pin position for a warning body (parses, then picks). */
export function pickBnmPosition(text) {
  return positionFromPoints(text, parseBnmPositions(text));
}

// ---------------------------------------------------------------------------
// Cancel-at expiry
// ---------------------------------------------------------------------------

const MONTHS = Object.freeze({
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
});

/**
 * `CANCEL AT//220000Z NOV 26//` → UTC epoch ms (2026-11-22 00:00 UTC).
 * Two-digit year is 20YY (BNM numbers are `NNNN-26`). Returns null when
 * the pattern is absent or invalid.
 */
export function parseCancelAt(text) {
  if (typeof text !== 'string') return null;
  const match =
    /CANCEL AT\/\/(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{2})\/\//i.exec(
      text,
    );
  if (!match) return null;
  const day = Number(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const month = MONTHS[match[4].toUpperCase()];
  const year = 2000 + Number(match[5]);
  if (month == null || day < 1 || day > 31 || hour > 23 || minute > 59)
    return null;
  const ms = Date.UTC(year, month, day, hour, minute, 0);
  // Date.UTC normalises overflow (e.g. Feb 31 → Mar 3): reject it.
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  )
    return null;
  return ms;
}

// ---------------------------------------------------------------------------
// Severity (our heuristic — the source carries no severity field)
// ---------------------------------------------------------------------------

const HIGH_DESCRIPTORS = new Set([
  'HAZ OPS',
  'HAZOPS',
  'RIGHT WHALE SLOW ZONE',
  'DREDGING',
  'MARINE EVENTS',
  'BRIDGE',
]);

/** @param {{criticality: ?string, descriptor: ?string, body: string}} warning */
export function severityForWarning({ criticality, descriptor }) {
  const crit = String(criticality ?? '')
    .toUpperCase()
    .trim();
  const desc = String(descriptor ?? '')
    .toUpperCase()
    .trim();
  if (crit === 'CANCELLATION') return 'info';
  if (crit === 'SCHEDULED') return 'low';
  if (crit === 'SAFETY') {
    if (HIGH_DESCRIPTORS.has(desc)) return 'high';
    // SAFETY + ATON (extinguished / missing / off-station / destroyed)
    // and SAFETY + anything else are both moderate.
    return 'moderate';
  }
  return 'moderate';
}

// ---------------------------------------------------------------------------
// Snapshot normalization
// ---------------------------------------------------------------------------

function textMatchesLocalWaterway(area, title) {
  const haystack = normalizeAreaText(`${area ?? ''} ${title ?? ''}`);
  if (!haystack) return false;
  return MARINE_LOCAL_WATERWAYS.some((waterway) =>
    haystack.includes(normalizeAreaText(waterway)),
  );
}

function positionInMarineBox(position, points) {
  if (position && pointInMarineBox(position.lat, position.lon)) return true;
  if (Array.isArray(points)) {
    for (const point of points) {
      if (pointInMarineBox(point.lat, point.lon)) return true;
    }
  }
  return false;
}

/**
 * Normalize a proxy payload into display rows.
 *
 * Proxy payload: `{ items: [{ feed, guid, title, link, pubDate,
 * description }] }` — description still carries its GovDelivery HTML.
 *
 * Returns `{ rows, cancelledCount, totalItems, pinnedCount, listOnlyCount }`
 * or null when the payload is malformed. `rows` are newest-first:
 *   { stableId, originator, number, criticality, area, descriptor,
 *     title, body, link, pubDateMs, lat, lon, hasPosition, polygon,
 *     vertices, severity, llnr, cancelAtMs }
 *
 * Rules, in order: parse every item → dedupe by stableId (newest
 * pubDate wins) → drop rows whose `cancelAt` has passed → cancellations
 * become tombstones (their in-force targets are removed and counted in
 * `cancelledCount`; the cancellation itself is never displayed)
 * → keep a row if a parsed position/polygon intersects
 * MARINE_BBOX, or — with no position — its geographic-area text names a
 * local waterway. District HAZOPS polygons south of 38.0 are dropped.
 */
export function normalizeMarineWarningsSnapshot(
  payload,
  { now = Date.now() } = {},
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const items = payload.items;
  if (!Array.isArray(items)) return null;

  const parsed = [];
  const tombstones = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const title = typeof item.title === 'string' ? item.title : '';
    const body = stripBnmHtml(item.description);
    const info = parseBnmTitle(title);
    const isCancellation = String(title.split('/')[0] ?? '')
      .trim()
      .toUpperCase()
      .startsWith('CANCELLATION');
    if (isCancellation) {
      // Single: the target is in the title too (`CANCEL SEC SDB BNM …` in
      // the body restates it). Multi: every `SEC SDB BNM NNNN-26` in the
      // body is a target.
      for (const ref of findBnmReferences(body)) tombstones.add(ref);
      if (info) tombstones.add(info.stableId);
      continue;
    }
    if (!info) continue; // untitled / unparseable: cannot dedupe, drop it
    parsed.push({ item, info, body });
  }

  const byStableId = new Map();
  for (const { item, info, body } of parsed) {
    const pubDateMs = Date.parse(item.pubDate ?? '');
    const row = {
      stableId: info.stableId,
      originator: info.originator,
      number: info.number,
      criticality: info.criticality,
      area: info.area,
      descriptor: info.descriptor,
      title: typeof item.title === 'string' ? item.title : '',
      body,
      link: typeof item.link === 'string' ? item.link : null,
      pubDateMs: Number.isFinite(pubDateMs) ? pubDateMs : null,
      cancelAtMs: parseCancelAt(body),
      llnr: (() => {
        const match = /LLNR\s+(\d+)/i.exec(body);
        return match ? match[1] : null;
      })(),
    };
    const previous = byStableId.get(row.stableId);
    if (!previous || (row.pubDateMs ?? 0) > (previous.pubDateMs ?? 0)) {
      byStableId.set(row.stableId, row);
    }
  }

  // Expired first: a tombstone for an already-expired row is not a
  // cancellation worth counting — cancelledCount is in-force rows removed
  // by a cancellation notice.
  let cancelledCount = 0;
  const inForce = [];
  for (const row of byStableId.values()) {
    if (row.cancelAtMs != null && row.cancelAtMs <= now) continue;
    if (tombstones.has(row.stableId)) {
      cancelledCount += 1;
      continue;
    }
    inForce.push(row);
  }

  const rows = [];
  for (const row of inForce) {
    const points = parseBnmPositions(row.body);
    const position = positionFromPoints(row.body, points);
    const hasPosition = position != null;
    const inBox = hasPosition ? positionInMarineBox(position, points) : false;
    if (hasPosition) {
      if (!inBox) continue;
      row.lat = position.lat;
      row.lon = position.lon;
      row.polygon = position.polygon;
      row.vertices = position.vertices;
    } else {
      if (!textMatchesLocalWaterway(row.area, row.title)) continue;
      row.lat = null;
      row.lon = null;
      row.polygon = false;
      row.vertices = 0;
    }
    row.hasPosition = hasPosition;
    row.severity = severityForWarning({
      criticality: row.criticality,
      descriptor: row.descriptor,
      body: row.body,
    });
    rows.push(row);
  }

  rows.sort((a, b) => (b.pubDateMs ?? 0) - (a.pubDateMs ?? 0));
  const pinnedCount = rows.filter((row) => row.hasPosition).length;
  return {
    rows,
    cancelledCount,
    totalItems: items.length,
    pinnedCount,
    listOnlyCount: rows.length - pinnedCount,
  };
}

export { MARINE_BBOX };
