// src/layers/outbreaks/records.js
// Pure record rules for CDC ArboNET state/county rows and WHO Disease
// Outbreak News items: normalize the rows the server provider returns,
// keep the two halves source-labeled, and never present a count without
// its as-of date. No network, no Cesium, no clock. Counts are CDC/WHO's
// own — never re-scored here. Whole-payload rejection mirrors
// normalizeIodaSnapshot: a malformed payload never partially overwrites
// good data. A county with zero reported cases shows "0 reported" only
// when the table actually covers that county — otherwise "no data".
import {
  OUTBREAKS_CAPE_MAY_FIPS,
  OUTBREAKS_NJ_COUNTIES,
  OUTBREAKS_NJ_STATE_CODE,
} from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/**
 * Normalize one ArboNET state row ({state, cases, band}) to a display
 * row, or null when it is not a usable row. A row needs a state code and
 * a numeric case count. The band ("9 to 25", ">25") is CDC's own legend
 * bucket, kept verbatim.
 */
export function normalizeArbonetStateRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = textValue(raw.state);
  if (!state) return null;
  const cases = numValue(raw.cases);
  if (cases === null) return null;
  return {
    kind: 'state',
    state,
    cases,
    band: textValue(raw.band),
    source: 'CDC ArboNET',
  };
}

/**
 * Normalize one ArboNET county row
 * ({fips, activity, humanCases, neuroinvasive, donors}) to a display
 * row, or null when it is not a usable row. A row needs a FIPS code and
 * a human-case count. The county name comes from the NJ FIPS table; a
 * FIPS outside New Jersey keeps a null name (the provider only ships NJ
 * counties, so a null name means a provider bug, not a missing county).
 * The activity string ("Human infections", "Non-human activity", …) is
 * CDC's literal value, kept verbatim.
 */
export function normalizeArbonetCountyRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fips = textValue(raw.fips);
  if (!fips) return null;
  const humanCases = numValue(raw.humanCases);
  if (humanCases === null) return null;
  return {
    kind: 'county',
    fips,
    county: OUTBREAKS_NJ_COUNTIES[fips] ?? null,
    activity: textValue(raw.activity),
    humanCases,
    neuroinvasive: numValue(raw.neuroinvasive),
    donors: numValue(raw.donors),
    source: 'CDC ArboNET',
  };
}

/**
 * Normalize one WHO DON item ({id, title, date, dateIso, url}) to a
 * display row, or null when it is not a usable row. An item needs a DON
 * id and a title. The id comes from the item URL ("/2026-DON626" →
 * "DON626"); the date is WHO's FormattedDate ("13 November 2026").
 */
export function normalizeDonItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = textValue(raw.id);
  if (!id) return null;
  const title = textValue(raw.title);
  if (!title) return null;
  return {
    kind: 'don',
    id,
    title,
    date: textValue(raw.date),
    dateIso: textValue(raw.dateIso),
    url: textValue(raw.url),
    source: 'WHO DON',
  };
}

/**
 * Validate a provider payload and normalize its rows. Returns the
 * snapshot or null when malformed. Empty arrays are valid snapshots (a
 * quiet season), but only when the envelope is well-formed. The Cape
 * May row is pulled out for the overlay title; when the county table
 * does not cover Cape May, capeMay is null ("no data", never "0").
 */
export function normalizeOutbreaksSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (typeof payload.fetchedAt !== 'number') return null;
  const arbonet =
    payload.arbonet && typeof payload.arbonet === 'object'
      ? payload.arbonet
      : null;
  const don =
    payload.don && typeof payload.don === 'object' ? payload.don : null;
  if (!arbonet || !don) return null;
  if (!Array.isArray(arbonet.states) || !Array.isArray(arbonet.njCounties))
    return null;
  if (!Array.isArray(don.items)) return null;
  const states = [];
  for (const raw of arbonet.states) {
    const row = normalizeArbonetStateRow(raw);
    if (row) states.push(row);
  }
  const njCounties = [];
  for (const raw of arbonet.njCounties) {
    const row = normalizeArbonetCountyRow(raw);
    if (row) njCounties.push(row);
  }
  const donItems = [];
  for (const raw of don.items) {
    const row = normalizeDonItem(raw);
    if (row) donItems.push(row);
  }
  const njRow = states.find((row) => row.state === OUTBREAKS_NJ_STATE_CODE);
  const capeMay =
    njCounties.find((row) => row.fips === OUTBREAKS_CAPE_MAY_FIPS) ?? null;
  return {
    fetchedAt: payload.fetchedAt,
    stale: payload.stale === true,
    ttlMs:
      typeof payload.ttlMs === 'number' && payload.ttlMs > 0
        ? payload.ttlMs
        : null,
    arbonet: {
      ok: arbonet.ok === true,
      asOf: textValue(arbonet.asOf),
      status: textValue(arbonet.status),
      states,
      njCounties,
    },
    don: {
      ok: don.ok === true,
      items: donItems,
    },
    counts: {
      states: states.length,
      njCounties: njCounties.length,
      don: donItems.length,
      njCases: njRow?.cases ?? null,
      capeMayHumanCases: capeMay?.humanCases ?? null,
    },
    capeMay,
  };
}

/** Most reported cases first. */
export function sortArbonetStateRows(rows) {
  return [...rows].sort((a, b) => b.cases - a.cases);
}

/** Most human cases first, then county name. */
export function sortArbonetCountyRows(rows) {
  return [...rows].sort(
    (a, b) =>
      b.humanCases - a.humanCases ||
      String(a.county ?? '').localeCompare(String(b.county ?? '')),
  );
}

/** Newest DON first (ISO date, falling back to the display date). */
export function sortDonItems(rows) {
  return [...rows].sort((a, b) =>
    String(b.dateIso ?? b.date ?? '').localeCompare(
      String(a.dateIso ?? a.date ?? ''),
    ),
  );
}

/** NJ counties with at least one human case, most first. */
export function countiesWithHumanCases(rows) {
  return sortArbonetCountyRows(rows.filter((row) => row.humanCases > 0));
}
