// src/layers/navarea/records.js
// Pure record rules for NGA NAVAREA warnings: the plain-text bulletin
// parser (positions, in-force list, cancels), the category keyword
// table, and snapshot validation. No network, no Cesium, no clock.
//
// Bulletin shape (NAVAREA IV, verified from the indexed live text,
// 131705Z NOV 26): a header block "NAVAREA IV 1098/26." carries the
// in-force list ("NAVAREA IV WARNINGS IN FORCE AS OF 131651Z NOV.
// ALL THE INFORCE WARNINGS ARE LISTED HERE. 1097/2026, ...") and
// CANCEL lines; each warning is a block headed by a DTG line
// ("131431Z NOV 26") + "NAVAREA IV 1097/26" + region lines +
// numbered paragraphs. Positions are maritime format
// (DD-MM.MM[N/S] DDD-MM.MM[E/W], e.g. 17-02.98N 061-57.65W), also
// with one decimal minute (19-23.0N 092-03.1W) or none (52-00N
// 056-00W). Categories are OUR keyword reading, never NGA's own —
// NGA publishes prose with no subject field.
import { NAVAREA_SOLAS_NOTE } from './policy.js';

export const NAVAREA_SOLAS_NOTE_TEXT = NAVAREA_SOLAS_NOTE;

const POSITION_RE =
  /(\d{1,2})-(\d{1,2}(?:\.\d+)?)([NS])\s+(\d{1,3})-(\d{1,2}(?:\.\d+)?)([EW])/g;

/** Parse one maritime position to decimal degrees, or null. */
export function parsePosition(text) {
  const match = new RegExp(POSITION_RE.source).exec(String(text ?? ''));
  if (!match) return null;
  const lat = Number(match[1]) + Number(match[2]) / 60;
  const lon = Number(match[4]) + Number(match[5]) / 60;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat: match[3] === 'S' ? -lat : lat,
    lon: match[6] === 'W' ? -lon : lon,
  };
}

/** Every position in a warning's prose, in order, de-duplicated. */
export function extractPositions(text) {
  const found = [];
  const seen = new Set();
  for (const match of String(text ?? '').matchAll(POSITION_RE)) {
    const position = parsePosition(match[0]);
    if (!position) continue;
    const key = `${position.lat.toFixed(5)},${position.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(position);
  }
  return found;
}

/**
 * Category keyword table (first match wins, case-insensitive). These
 * are our readings of the prose, not NGA categories.
 */
export const NAVAREA_CATEGORY_KEYWORDS = Object.freeze([
  [
    'live-fire',
    [
      'HAZARDOUS OPERATIONS',
      'FIRING',
      'ROCKET LAUNCHING',
      'GUNNERY',
      'MISSILE',
    ],
  ],
  ['wreck', ['WRECK', 'SUNK', 'SANK', 'AGROUND', 'DERELICT']],
  ['drifting-object', ['ADRIFT', 'DRIFTING', 'UNCREWED', 'MAN OVERBOARD']],
  ['cable-work', ['CABLE', 'CABLE SHIP']],
  ['aid-to-navigation', ['LIGHT', 'BUOY', 'RADIO STATION', 'OFF AIR', 'AIS']],
  ['survey', ['SURVEY', 'DREDGING', 'DRILLING', 'SEISMIC']],
]);

export function categorizeWarning(text) {
  const upper = String(text ?? '').toUpperCase();
  for (const [category, keywords] of NAVAREA_CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => upper.includes(keyword))) return category;
  }
  return 'other';
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse one daily NAVAREA IV bulletin (plain text) into its warnings.
 * The in-force list inside the 1098/26-style index block is
 * authoritative: warnings absent from it, and warnings named by a
 * CANCEL line, are dropped. The index block itself is not a warning.
 * A warning with no parseable position still lists, with
 * positionParse false — it shows in the list, just without a pin.
 */
export function parseNavareaBulletin(text) {
  const source = String(text ?? '');
  const lines = source.split(/\r?\n/);
  const blocks = [];
  let current = null;
  const headerRe = /NAVAREA IV (\d+)\/(\d+)\.?/;
  const dtgRe = /^(\d{6}Z [A-Z]{3} \d{2})$/;
  const dtgAnyRe = /(\d{6}Z [A-Z]{3} \d{2})/;
  let pendingDtg = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const dtg = dtgRe.exec(line);
    if (dtg) {
      pendingDtg = dtg[1];
      continue;
    }
    const header = headerRe.exec(line);
    if (header) {
      // "CANCEL NAVAREA IV 1072/26." names a warning to drop — it is
      // content of the current block, never a new block's header.
      const before = line.slice(0, header.index);
      if (before.toUpperCase().includes('CANCEL')) {
        if (current && line) current.lines.push(line);
        continue;
      }
      // A DTG may ride on the same line ahead of the header
      // ("110709Z NOV 26, NAVAREA IV 1086/26., CARIBBEAN SEA.").
      const dtgBefore = dtgAnyRe.exec(before);
      // Text ahead of the header belongs to the warning that was
      // running ("...22-41.12N 078-53.02W UNRELIABLE., 110709Z NOV 26,
      // NAVAREA IV 1086/26.") — keep it, minus the DTG itself.
      const beforeText = before
        .replace(dtgAnyRe, '')
        .replace(/^,\s*|\s*,\s*$/g, '')
        .trim();
      if (current && beforeText) current.lines.push(beforeText);
      if (current) blocks.push(current);
      current = {
        number: Number(header[1]),
        year: Number(header[2]),
        issuedAt: dtgBefore ? dtgBefore[1] : pendingDtg,
        lines: [],
      };
      pendingDtg = null;
      const after = line
        .slice(header.index + header[0].length)
        .replace(/^,\s*/, '')
        .trim();
      if (after) current.lines.push(after);
      continue;
    }
    if (current && line) current.lines.push(line);
  }
  if (current) blocks.push(current);

  let bulletinDate = null;
  const inForce = new Set();
  const cancelled = new Set();
  const inForceDateRe = /NAVAREA IV WARNINGS IN FORCE AS OF (\d{6}Z [A-Z]{3})/;
  const cancelRe = /CANCEL NAVAREA IV (\d+)\/(\d+)/g;
  for (const block of blocks) {
    const joined = block.lines.join(' ');
    const dateMatch = inForceDateRe.exec(joined);
    if (dateMatch) bulletinDate = dateMatch[1];
    for (const match of joined.matchAll(/(\d+)\/(\d{4})/g)) {
      // The in-force list names warnings as NNNN/YYYY; the index
      // block's own number (1098/26) is two-digit-year, not listed.
      if (block.lines.some((entry) => entry.includes('IN FORCE'))) {
        inForce.add(`${Number(match[1])}/${Number(match[2])}`);
      }
    }
    for (const match of joined.matchAll(cancelRe)) {
      cancelled.add(`${Number(match[1])}/${Number(match[2])}`);
    }
  }

  const warnings = [];
  for (const block of blocks) {
    const id = `${block.number}/${block.year}`;
    // The index block (its text names the in-force list) is metadata.
    if (block.lines.some((entry) => entry.includes('IN FORCE'))) continue;
    if (inForce.size > 0 && !inForce.has(`${block.number}/20${block.year}`))
      continue;
    if (cancelled.has(id)) continue;
    const areaLines = [];
    for (const entry of block.lines) {
      if (/^\d+\./.test(entry)) break;
      areaLines.push(entry);
    }
    const fullText = block.lines.join(' ');
    const positions = extractPositions(fullText);
    warnings.push({
      id: `NAVAREA IV ${id}`,
      number: block.number,
      year: block.year,
      area: areaLines.join(' '),
      text: fullText,
      positions,
      positionParse: positions.length > 0,
      category: categorizeWarning(fullText),
      issuedAt: block.issuedAt,
    });
  }
  return {
    bulletinDate,
    inForceCount: inForce.size,
    warnings,
  };
}

/** Validate one provider snapshot; returns null for anything unusable. */
export function validateNavareaSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload.warnings)) return null;
  const warnings = [];
  for (const raw of payload.warnings) {
    if (!raw || typeof raw !== 'object') continue;
    const id = textValue(raw.id);
    if (!id) continue;
    warnings.push({
      id,
      number: numValue(raw.number),
      year: numValue(raw.year),
      area: textValue(raw.area),
      text: textValue(raw.text),
      positions: (Array.isArray(raw.positions) ? raw.positions : [])
        .map((position) => ({
          lat: numValue(position?.lat),
          lon: numValue(position?.lon),
        }))
        .filter((position) => position.lat !== null && position.lon !== null),
      positionParse: raw.positionParse === true,
      category: textValue(raw.category) ?? 'other',
      issuedAt: textValue(raw.issuedAt),
    });
  }
  return {
    fetchedAt: numValue(payload.fetchedAt),
    stale: payload.stale === true,
    bulletinDate: textValue(payload.bulletinDate),
    inForceCount: numValue(payload.inForceCount) ?? warnings.length,
    warnings,
  };
}
