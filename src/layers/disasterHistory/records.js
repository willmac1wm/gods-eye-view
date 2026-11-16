/**
 * County disaster-history records: OpenFEMA declarations + NOAA NCEI Storm
 * Events snapshot rows.
 *
 * Live county verification 2026-11-16 (OpenFEMA API v2, filter
 * state='NJ' + designatedArea='Cape May (County)'): 34 declarations,
 * 1965-08-18 (DR-205-NJ, Drought, WATER SHORTAGE) → 2021-09-05
 * (DR-4614-NJ, Hurricane, REMNANTS OF HURRICANE IDA). By type: Hurricane
 * 10, Snowstorm 6, Severe Storm 5, Flood 4, Biological 2, Drought 2,
 * Coastal Storm 2, Fire 1, Other 1, Severe Ice Storm 1. DR 22, EM 12.
 *
 * Storm Events snapshot (bulk CSV files, years 2012/2021/2024/2025):
 * 2012: 78 rows (incl. 6 Sandy rows, 28–29 Oct, ~$415M county damage),
 * 2021: 16, 2024: 24, 2025: 27 rows (Winter Weather 7, High Wind 4,
 * Winter Storm 4, Coastal Flood 4, Thunderstorm Wind 2, Flash Flood 2,
 * Dense Fog 2, Excessive Heat 1, Hail 1; 0 deaths, 0 injuries).
 * The two halves are kept separate (FEMA declarations vs individual storm
 * events) and never added together — same split as HazardNow's county atlas.
 */
import { STORM_EVENTS_SNAPSHOT } from './stormEventsSnapshot.js';

export { STORM_EVENTS_SNAPSHOT };

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function boolValue(value) {
  return value === true;
}

/**
 * Map one OpenFEMA DisasterDeclarationsSummaries row to a plain
 * declaration record. Null for anything unusable.
 * @param {object} row - raw OpenFEMA row
 * @returns {object|null}
 */
export function normalizeDeclaration(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = textValue(row.femaDeclarationString);
  const declarationDate = textValue(row.declarationDate);
  if (!id || !declarationDate || !ISO_DATE_PATTERN.test(declarationDate))
    return null;
  const incidentType = textValue(row.incidentType);
  if (!incidentType) return null;
  return {
    id,
    disasterNumber: Number.isSafeInteger(row.disasterNumber)
      ? row.disasterNumber
      : null,
    declarationType: textValue(row.declarationType),
    declarationDate,
    incidentType,
    declarationTitle: textValue(row.declarationTitle),
    incidentBeginDate: textValue(row.incidentBeginDate),
    incidentEndDate: textValue(row.incidentEndDate),
    programs: {
      publicAssistance: boolValue(row.paProgramDeclared),
      individualAssistance: boolValue(row.iaProgramDeclared),
      hazardMitigation: boolValue(row.hmProgramDeclared),
    },
  };
}

/**
 * Validate a whole OpenFEMA payload. Returns { declarations, count } with
 * declarations newest-first, or null when malformed / empty. A malformed
 * payload never partially overwrites good data.
 * @param {*} payload - raw OpenFEMA JSON
 * @returns {{declarations: Array, count: number}|null}
 */
export function normalizeOpenFemaResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const rows = payload.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) return null;
  const declarations = rows.map(normalizeDeclaration).filter(Boolean);
  if (declarations.length === 0) return null;
  declarations.sort((a, b) => (a.declarationDate < b.declarationDate ? 1 : -1));
  const count =
    Number.isSafeInteger(payload?.metadata?.count) &&
    payload.metadata.count >= declarations.length
      ? payload.metadata.count
      : declarations.length;
  return { declarations, count };
}

/**
 * Parse a Storm Events DAMAGE_PROPERTY / DAMAGE_CROPS value ("125.00M",
 * "0.00K", "2.50B", "" ) into dollars, or null when blank/unparseable.
 * Never returns 0 for a blank value — blank means unknown, not zero.
 * @param {*} value - raw damage string
 * @returns {number|null}
 */
export function parseStormDamage(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = /^([\d.]+)\s*([KMB])$/i.exec(text);
  if (!match) {
    const plain = Number(text);
    return Number.isFinite(plain) ? plain : null;
  }
  const multipliers = { K: 1e3, M: 1e6, B: 1e9 };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return amount * multipliers[match[2].toUpperCase()];
}

/**
 * Count snapshot rows by event_type, most frequent first.
 * @param {Array} rows - normalized storm-event rows
 * @returns {Array<{type: string, count: number}>}
 */
export function countStormEventsByType(rows) {
  if (!Array.isArray(rows)) return [];
  const counts = new Map();
  for (const row of rows) {
    if (!row || typeof row.event_type !== 'string' || !row.event_type.trim())
      continue;
    const type = row.event_type.trim();
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Per-year summary over the snapshot years: row count, type counts,
 * deaths, injuries, and summed property damage (blank damage counts as
 * unknown, not zero — the total is a lower bound and is labeled as one).
 * @param {object} years - { '2012': [rows], … }
 * @returns {object} { '2012': { count, byType, deaths, injuries, damagePropertyTotal, damageKnown }, … }
 */
export function summarizeStormEventYears(years) {
  if (!years || typeof years !== 'object' || Array.isArray(years)) return {};
  const summary = {};
  for (const [year, rows] of Object.entries(years)) {
    if (!Array.isArray(rows)) continue;
    let deaths = 0;
    let injuries = 0;
    let damagePropertyTotal = 0;
    let damageKnown = false;
    for (const row of rows) {
      deaths += Number.isSafeInteger(row?.deaths_direct)
        ? row.deaths_direct
        : 0;
      injuries += Number.isSafeInteger(row?.injuries_direct)
        ? row.injuries_direct
        : 0;
      const damage = parseStormDamage(row?.damage_property);
      if (damage != null) {
        damagePropertyTotal += damage;
        damageKnown = true;
      }
    }
    summary[year] = {
      count: rows.length,
      byType: countStormEventsByType(rows),
      deaths,
      injuries,
      damagePropertyTotal: damageKnown ? damagePropertyTotal : null,
    };
  }
  return summary;
}

/**
 * Group declarations by decade ("1960s", "1970s", …) for the timeline.
 * @param {Array} declarations - normalized declarations, newest first
 * @returns {Array<{decade: string, count: number, declarations: Array}>}
 */
export function groupDeclarationsByDecade(declarations) {
  if (!Array.isArray(declarations)) return [];
  const groups = new Map();
  for (const declaration of declarations) {
    if (!declaration?.declarationDate) continue;
    const year = Number(declaration.declarationDate.slice(0, 4));
    if (!Number.isSafeInteger(year)) continue;
    const decade = `${Math.floor(year / 10) * 10}s`;
    if (!groups.has(decade)) groups.set(decade, []);
    groups.get(decade).push(declaration);
  }
  return [...groups.entries()]
    .map(([decade, rows]) => ({
      decade,
      count: rows.length,
      declarations: rows,
    }))
    .sort((a, b) => (a.decade < b.decade ? 1 : -1));
}

/**
 * Validate a provider snapshot before it can replace the displayed
 * history. The Storm Events half is local and always present; the FEMA
 * half must be a non-empty normalized list.
 * @param {*} snapshot - provider snapshot
 * @returns {object} the snapshot, unchanged
 */
export function validateDisasterSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.declarations) ||
    snapshot.declarations.length === 0 ||
    typeof snapshot.declarationCount !== 'number' ||
    !snapshot.declarations.every(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        row.id.trim() &&
        typeof row.declarationDate === 'string' &&
        typeof row.incidentType === 'string',
    ) ||
    !snapshot.stormEvents ||
    typeof snapshot.stormEvents !== 'object' ||
    typeof snapshot.stormEvents.years !== 'object'
  ) {
    throw new TypeError('Disaster history source returned an invalid snapshot');
  }
  return snapshot;
}
