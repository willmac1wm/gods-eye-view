/**
 * VDL2 datalink messages — categorization, locality, and normalization
 * for the VDL2 layer (airframes.io, via the same-origin `/api/vdl2`
 * proxy — see server/providers/vdl2.js).
 *
 * VDL2 vs ACARS: the same endpoint serves both with the same 31-key
 * record shape and NO CPDLC/ADS-C/AOC type field. They are distinguished
 * only by `sourceType` (`"vdl"` vs `"acars"`) and `source`
 * (`dumpvdl2`/`vdlm2dec` vs `acarsdec`). `mode` and `label` are NOT
 * discriminators (both overlap). The `sourceType=vdl` query param is
 * ignored by the API (verified live 2026-11-16: a `sourceType=vdl`
 * request returned 87 vdl / 8 acars / 5 aero-acars in 100 rows), so
 * filtering is client-side here, on `sourceType`.
 *
 * Coverage: the live feeder is PhillyRox-VDLM at Philadelphia (KPHL),
 * station id 237335008, 39.95258, −75.16522, ≥100 messages/hour
 * (verified live 2026-11-16 — the last-hour station query hit the
 * 100-row API limit). CORRECTION: the Python ACARS watcher's docstring
 * names a "Trenton" VDL2 station `RK-KBOS_TRENTON-VDL2`; that station
 * is actually in New Hampshire (43.12, −71.77), NOT Trenton — it is
 * not used here, and the docstring must not be copied.
 *
 * Honest limitation: ~23% of PhillyRox VDL2 messages (45% globally
 * per the prep check) are label-None, text-null, data-null frames —
 * almost certainly CPDLC/ADS-C AVLC payloads the public API does not
 * decode (`decodings: []` on the detail endpoint too, verified live
 * 2026-11-16). They are counted as "undecoded frames" and must NOT be
 * presented as a CPDLC feed until a decoding source is found.
 *
 * Category logic is ported from the Cape Dispatch ACARS watcher
 * (~/workspace/cape-news/app/acars_watch.py, 2026-11-15) — same
 * keywords, same categories, same false-positive exclusions, same
 * nationwide-emergency scope (William, 2026-11-15): the seven
 * critical categories alert anywhere in the US; diversion, medical,
 * minimum fuel, bird strike, and ground stop stay local-only (ground
 * stop goes nationwide only when the text says nationwide / national /
 * all airports).
 *
 * GUARDRAIL (same as ACARS): alert on categories, NEVER republish
 * verbatim sensitive free text. The raw `text` is used only to
 * categorize, server-side in the proxy, and is deliberately excluded
 * from every normalized row — rows carry the category, the flight,
 * the tail, the position, and the time, plus a link out to the
 * original message on airframes.io for a human to read.
 *
 * Positions: VDL2 messages usually carry no message-level position
 * (null lat/lon/altitude — 0 of 100 PhillyRox messages had one,
 * verified live). A position comes only from the nested `flight` fix,
 * and that fix can be stale: one PhillyRox message's flight fix was
 * 41.06, −104.46 (Colorado) — a VHF message heard in Philadelphia
 * cannot come from an aircraft over Colorado. A fix is therefore kept
 * only when it falls inside the local airspace box; anything else is
 * treated as no position.
 */

/** airframes.io station id of the PhillyRox-VDLM feeder. */
export const VDL2_STATION_ID = 237335008;
/** Feeder ident as airframes.io reports it. */
export const VDL2_STATION_IDENT = 'PhillyRox-VDLM';
/** Nearest airport of the feeder (KPHL, Philadelphia). */
export const VDL2_STATION_AIRPORT = 'KPHL';
/** Feeder position, as airframes.io reports it (verified 2026-11-16). */
export const VDL2_STATION_POSITION = Object.freeze({
  lat: 39.95258,
  lon: -75.16522,
});

/** airframes.io public messages endpoint (proxy-side; no key). */
export const VDL2_API_BASE = 'https://api.airframes.io/v1/messages';
/** The API returns at most 100 messages per call. */
export const VDL2_API_LIMIT = 100;

/** Server-side substring queries, one per cycle (watcher keywords). */
export const VDL2_KEYWORDS = Object.freeze([
  'DIVERT',
  'EMERGENCY',
  'MAYDAY',
  'PAN PAN',
  'MEDICAL',
  'ENGINE FAIL',
  'GROUND STOP',
  'MINIMUM FUEL',
  'SMOKE',
  'DEPRESSUR',
  'BIRD STRIKE',
]);

/** Local airports / place names (upper, matched against message text). */
export const VDL2_LOCAL_TEXT_MARKERS = Object.freeze([
  'ACY',
  'PHL',
  'EWR',
  'KWWD',
  'KACY',
  'ATLANTIC CITY',
  'CAPE MAY',
  'PHILADELPHIA',
  'NEWARK',
]);
export const VDL2_LOCAL_AIRPORTS = Object.freeze([
  'ACY',
  'PHL',
  'EWR',
  'KACY',
  'KWWD',
]);
export const VDL2_LOCAL_STATION_AIRPORTS = Object.freeze([
  'KACY',
  'KPHL',
  'KEWR',
  'KWWD',
]);
/** South Jersey / Philly / NYC-approach airspace (watcher bbox). */
export const VDL2_LOCAL_BBOX = Object.freeze({
  latMin: 38.3,
  latMax: 40.6,
  lonMin: -75.8,
  lonMax: -73.3,
});

/** (pattern, category, severity) — checked in order, first match wins. */
export const VDL2_CATEGORIES = Object.freeze([
  { pattern: /\bMAYDAY\b/, category: 'mayday', severity: 'critical' },
  { pattern: /\bPAN[\s-]?PAN\b/, category: 'pan-pan', severity: 'critical' },
  { pattern: /\bEMERGENCY\b/, category: 'emergency', severity: 'critical' },
  { pattern: /ENGINE\s+FAIL/, category: 'engine failure', severity: 'critical' },
  { pattern: /\bSMOKE\b/, category: 'smoke on board', severity: 'critical' },
  { pattern: /FIRE\s+ON\s+BOARD/, category: 'fire on board', severity: 'critical' },
  { pattern: /DEPRESSUR/, category: 'depressurisation', severity: 'critical' },
  { pattern: /\bDIVERT/, category: 'diversion', severity: 'high' },
  { pattern: /\bMEDICAL\b/, category: 'medical', severity: 'high' },
  { pattern: /MINIMUM\s+FUEL/, category: 'minimum fuel', severity: 'high' },
  { pattern: /GROUND\s+STOP/, category: 'ground stop', severity: 'high' },
  { pattern: /BIRD\s+STRIKE/, category: 'bird strike', severity: 'high' },
]);

/** Critical emergency categories alert NATIONWIDE (William, 2026-11-15). */
export const VDL2_NATIONWIDE_CATEGORIES = Object.freeze([
  'mayday',
  'pan-pan',
  'emergency',
  'engine failure',
  'smoke on board',
  'fire on board',
  'depressurisation',
]);

/** Routine-context exclusions, all seen live by the watcher 2026-11-15. */
export const VDL2_EMERGENCY_EXCLUSIONS = Object.freeze([
  'DANGEROUS GOODS',
  'EMERGENCY AIRCRAFT',
  'EMERGENCY EQUIPMENT',
  'EMERGENCY EXIT',
  'EMERGENCY LOCATOR',
]);
export const VDL2_ENGINE_FAILURE_EXCLUSIONS = Object.freeze([
  'ACCEL HT', // takeoff performance data, not an actual failure
  'FAIL TO START',
  'FAILED TO START',
]);
export const VDL2_SMOKE_EXCLUSIONS = Object.freeze([
  'SMOKE DET', // smoke-detector fault / maintenance chatter
  'SMOKE DETECTOR',
]);

/** Display label per category — data, not UI prose (see model.js). */
export const VDL2_CATEGORY_LABEL = Object.freeze({
  mayday: 'Mayday call',
  'pan-pan': 'Pan-pan call',
  emergency: 'Emergency declared',
  'engine failure': 'Engine failure',
  'smoke on board': 'Smoke on board',
  'fire on board': 'Fire on board',
  depressurisation: 'Depressurisation',
  diversion: 'Diversion',
  medical: 'Medical issue on board',
  'minimum fuel': 'Minimum fuel',
  'ground stop': 'Ground stop',
  'bird strike': 'Bird strike',
  undecoded: 'Undecoded frame',
});

/** Severity of the undecoded-frame pseudo-category (counted, not alerted). */
export const VDL2_UNDECODED_SEVERITY = 'info';

/** Known categories, including the undecoded pseudo-category. */
export const VDL2_KNOWN_CATEGORIES = Object.freeze([
  ...VDL2_CATEGORIES.map((entry) => entry.category),
  'undecoded',
]);

/** Defensive cap on rows per snapshot (the API caps at 100 per call). */
export const VDL2_MAX_ROWS = 200;

function upperCollapsed(text) {
  return String(text ?? '')
    .toUpperCase()
    .split(/\s+/)
    .join(' ')
    .trim();
}

function flightString(msg) {
  const flight = msg?.flight;
  if (flight && typeof flight === 'object')
    return String(flight.flight ?? flight.flightIcao ?? '').trim();
  return String(flight ?? msg?.flightNumber ?? '').trim();
}

function tailString(msg) {
  const airframe = msg?.airframe;
  if (airframe && typeof airframe === 'object')
    return String(airframe.tail ?? '').trim();
  return String(msg?.tail ?? '').trim();
}

function stationOf(msg) {
  const station = msg?.station;
  return station && typeof station === 'object' ? station : {};
}

function finiteOrNull(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function flightFixOf(msg) {
  const flight = msg?.flight;
  if (!flight || typeof flight !== 'object') return { lat: null, lon: null };
  return {
    lat: finiteOrNull(flight.latitude),
    lon: finiteOrNull(flight.longitude),
  };
}

function inLocalBbox(lat, lon) {
  if (lat == null || lon == null) return false;
  const box = VDL2_LOCAL_BBOX;
  return (
    lat >= box.latMin &&
    lat <= box.latMax &&
    lon >= box.lonMin &&
    lon <= box.lonMax
  );
}

/**
 * Is this airframes.io record a VDL2 message? The discriminator is
 * `sourceType === 'vdl'` — `mode` and `label` overlap with ACARS and
 * the `sourceType` query param is ignored by the API. Never throws.
 */
export function isVdl2Message(msg) {
  return !!msg && typeof msg === 'object' && msg.sourceType === 'vdl';
}

/**
 * Is this VDL2 message an undecoded frame — label-None, text-null,
 * data-null, almost certainly a CPDLC/ADS-C AVLC payload the public
 * API does not decode? Never throws.
 */
export function isUndecodedFrame(msg) {
  if (!msg || typeof msg !== 'object') return false;
  return msg.label == null && msg.text == null && msg.data == null;
}

/**
 * Categorize one message's raw text, watcher rules: first matching
 * category wins, then the routine-context exclusions, then the
 * negation guard ("NO SMOKE ON" is not smoke on board). A national
 * ground stop is critical, a local one high. Returns
 * `{ category, severity }` or null. Never throws. The text is used
 * only here, server-side in the proxy — it never reaches a row.
 */
export function categorizeVdl2Text(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  // ACARS/VDL2 text uses CR/LF line breaks, so a phrase can be split
  // across lines ("EMERGENCY\rAIRCRAFT"). Collapse all whitespace
  // before any phrase matching — categories and exclusions alike.
  const upper = upperCollapsed(text);
  let category = null;
  let severity = null;
  for (const entry of VDL2_CATEGORIES) {
    if (entry.pattern.test(upper)) {
      category = entry.category;
      severity = entry.severity;
      break;
    }
  }
  if (category == null) return null;
  if (category === 'smoke on board' && upper.includes('NO SMOKE'))
    return null;
  if (
    category === 'emergency' &&
    VDL2_EMERGENCY_EXCLUSIONS.some((x) => upper.includes(x))
  )
    return null;
  if (
    category === 'engine failure' &&
    VDL2_ENGINE_FAILURE_EXCLUSIONS.some((x) => upper.includes(x))
  )
    return null;
  if (
    category === 'smoke on board' &&
    VDL2_SMOKE_EXCLUSIONS.some((x) => upper.includes(x))
  )
    return null;
  if (category === 'ground stop' && isNationalGroundStop(upper))
    severity = 'critical';
  return { category, severity };
}

/** "GROUND STOP" + nationwide / national / all airports. */
export function isNationalGroundStop(upperText) {
  const upper = upperCollapsed(upperText);
  return (
    upper.includes('GROUND STOP') &&
    (upper.includes('NATIONWIDE') ||
      upper.includes('NATIONAL') ||
      upper.includes('ALL AIRPORTS') ||
      upper.includes('U.S. AIRPORTS') ||
      upper.includes('US AIRPORTS'))
  );
}

/**
 * Local airspace / local airports / local feeder (watcher `_is_local`,
 * ported). Never throws.
 */
export function isLocalVdl2Message(msg, textUpper = null) {
  try {
    if (!msg || typeof msg !== 'object') return false;
    const upper =
      textUpper ?? upperCollapsed(typeof msg.text === 'string' ? msg.text : '');
    if (
      VDL2_LOCAL_TEXT_MARKERS.some((marker) => upper.includes(marker))
    )
      return true;
    const flight = msg.flight;
    const airports = [];
    if (flight && typeof flight === 'object')
      airports.push(flight.departingAirport, flight.destinationAirport);
    airports.push(msg.departingAirport, msg.destinationAirport);
    if (
      airports.some(
        (airport) =>
          typeof airport === 'string' &&
          VDL2_LOCAL_AIRPORTS.includes(airport.trim().toUpperCase()),
      )
    )
      return true;
    const stationAirport = String(
      stationOf(msg).nearestAirportIcao ?? '',
    )
      .trim()
      .toUpperCase();
    if (VDL2_LOCAL_STATION_AIRPORTS.includes(stationAirport)) return true;
    let lat = finiteOrNull(msg.latitude);
    let lon = finiteOrNull(msg.longitude);
    if (lat == null || lon == null) {
      const fix = flightFixOf(msg);
      lat = fix.lat;
      lon = fix.lon;
    }
    if (lat != null && lon != null && inLocalBbox(lat, lon)) return true;
    return false;
  } catch {
    return false;
  }
}

function parseTimeMs(msg) {
  for (const key of ['createdAt', 'timestamp']) {
    const value = msg?.[key];
    if (typeof value !== 'string' || value === '') continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * Normalize one raw airframes.io message into a display row, or null
 * when it is not a VDL2 message in scope. The row NEVER carries the
 * raw `text` (guardrail — see the module header). A row is kept when
 * it is categorized and (a nationwide emergency or local), or when it
 * is a local undecoded frame. Never throws.
 */
export function vdl2MessageRow(msg) {
  if (!isVdl2Message(msg)) return null;
  const id = msg.id;
  if (id == null || id === '') return null;
  const text = typeof msg.text === 'string' ? msg.text : null;
  const categorized = text != null ? categorizeVdl2Text(text) : null;
  const undecoded = isUndecodedFrame(msg);
  const local = isLocalVdl2Message(msg);
  const nationwide =
    categorized != null &&
    VDL2_NATIONWIDE_CATEGORIES.includes(categorized.category);
  if (categorized != null) {
    if (!nationwide && !local) return null;
  } else if (undecoded) {
    if (!local) return null;
  } else {
    return null; // routine decodable traffic: counted in heardLocal, not listed
  }
  // Position: message fix first, else the flight fix — kept only
  // inside the local box (a flight fix can be stale/remote).
  let lat = finiteOrNull(msg.latitude);
  let lon = finiteOrNull(msg.longitude);
  if (lat == null || lon == null) {
    const fix = flightFixOf(msg);
    lat = fix.lat;
    lon = fix.lon;
  }
  const hasPosition =
    lat != null && lon != null && inLocalBbox(lat, lon);
  const flight = flightString(msg);
  const tail = tailString(msg);
  const station = stationOf(msg);
  return {
    id: String(id),
    stableId: `vdl2:${id}`,
    flight: flight === '' ? null : flight,
    tail: tail === '' ? null : tail,
    fromHex:
      typeof msg.fromHex === 'string' && msg.fromHex !== ''
        ? msg.fromHex
        : null,
    label: typeof msg.label === 'string' ? msg.label : null,
    mode: typeof msg.mode === 'string' ? msg.mode : null,
    frequency: Number.isFinite(Number(msg.frequency))
      ? Number(msg.frequency)
      : null,
    stationIdent:
      typeof station.ident === 'string' && station.ident !== ''
        ? station.ident
        : null,
    stationAirport:
      typeof station.nearestAirportIcao === 'string' &&
      station.nearestAirportIcao !== ''
        ? station.nearestAirportIcao
        : null,
    category: categorized ? categorized.category : 'undecoded',
    severity: categorized ? categorized.severity : VDL2_UNDECODED_SEVERITY,
    undecoded,
    hasPosition,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    timeMs: parseTimeMs(msg),
    url: `https://api.airframes.io/v1/messages/${id}`,
  };
}

/**
 * Select the display rows from a batch of raw airframes.io messages
 * (proxy-side: the baseline station fetch + the keyword fan-out).
 * Dedupes by message id, newest first, capped at VDL2_MAX_ROWS.
 * Never throws.
 */
export function selectVdl2Rows(messages) {
  if (!Array.isArray(messages)) return [];
  const seen = new Set();
  const rows = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const key = msg.id;
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    const row = vdl2MessageRow(msg);
    if (row) rows.push(row);
  }
  rows.sort(
    (a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0) || String(b.id).localeCompare(String(a.id)),
  );
  return rows.slice(0, VDL2_MAX_ROWS);
}

function validRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (row.id == null || row.id === '') return null;
  if (typeof row.category !== 'string') return null;
  if (!VDL2_KNOWN_CATEGORIES.includes(row.category)) return null;
  if (typeof row.severity !== 'string') return null;
  if (!['critical', 'high', 'info'].includes(row.severity)) return null;
  // The row must never carry raw text, even if a hand-built payload
  // tries to smuggle it in — drop the field outright.
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const hasPosition =
    row.hasPosition === true &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    inLocalBbox(lat, lon);
  const timeMs = Number.isFinite(Number(row.timeMs))
    ? Number(row.timeMs)
    : null;
  const textOf = (value) =>
    typeof value === 'string' && value !== '' ? value : null;
  return {
    id: String(row.id),
    stableId: textOf(row.stableId) ?? `vdl2:${row.id}`,
    flight: textOf(row.flight),
    tail: textOf(row.tail),
    fromHex: textOf(row.fromHex),
    label: textOf(row.label),
    mode: textOf(row.mode),
    frequency: Number.isFinite(Number(row.frequency))
      ? Number(row.frequency)
      : null,
    stationIdent: textOf(row.stationIdent),
    stationAirport: textOf(row.stationAirport),
    category: row.category,
    severity: row.severity,
    undecoded: row.undecoded === true,
    hasPosition,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    timeMs,
    url: textOf(row.url),
  };
}

/**
 * Normalize a proxy payload into display rows.
 *
 * Proxy payload: `{ fetchedAt, stale, heardLocal, heardTruncated,
 * stationFlagged, stationFlagReason, rows: [<row>] }` — see
 * server/providers/vdl2.js. Rows are validated (unknown categories
 * dropped, out-of-box positions cleared, any `text` field dropped);
 * counts are re-derived from the rows, never trusted from the proxy.
 *
 * Returns `{ rows, counts, categorizedCount, undecodedCount,
 * heardLocal, heardTruncated, stationFlagged, stationFlagReason,
 * fetchedAt, stale }` or null when the payload is malformed.
 */
export function normalizeVdl2Snapshot(payload, { now = Date.now() } = {}) {
  void now;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (!Array.isArray(payload.rows)) return null;
  const byId = new Map();
  for (const row of payload.rows) {
    const valid = validRow(row);
    if (!valid) continue;
    if (!byId.has(valid.id)) byId.set(valid.id, valid);
  }
  const rows = [...byId.values()].sort(
    (a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0) || String(b.id).localeCompare(String(a.id)),
  );
  const counts = {};
  for (const category of VDL2_KNOWN_CATEGORIES) counts[category] = 0;
  let undecodedCount = 0;
  for (const row of rows) {
    counts[row.category] += 1;
    if (row.undecoded) undecodedCount += 1;
  }
  const categorizedCount = rows.length - undecodedCount;
  return {
    rows,
    counts,
    categorizedCount,
    undecodedCount,
    heardLocal: Number.isFinite(Number(payload.heardLocal))
      ? Number(payload.heardLocal)
      : null,
    heardTruncated: payload.heardTruncated === true,
    stationFlagged: payload.stationFlagged === true,
    stationFlagReason:
      typeof payload.stationFlagReason === 'string' &&
      payload.stationFlagReason !== ''
        ? payload.stationFlagReason
        : null,
    fetchedAt: Number.isFinite(Number(payload.fetchedAt))
      ? Number(payload.fetchedAt)
      : null,
    stale: payload.stale === true,
  };
}
