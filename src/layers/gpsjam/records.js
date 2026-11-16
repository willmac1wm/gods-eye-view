/**
 * GPSJam daily GNSS interference — normalization for the daily published
 * aggregate from gpsjam.org (via the same-origin `/api/gpsjam` proxy).
 *
 * One CSV per UTC day, one row per H3 resolution-4 cell worldwide:
 * `hex,count_good_aircraft,count_bad_aircraft`. The proxy filters to the
 * county box + 0.5° margin and ships each cell's centroid + 6 boundary
 * vertices; this module validates what comes back and re-derives the
 * level from the aircraft counts (the proxy's level is never trusted
 * blindly).
 *
 * Levels use gpsjam.org's published formula and bands (see the
 * [GPSJAM FAQ](https://gpsjam.org/faq)): score =
 * `100 × max(0, bad − 1) / total`, under 2% low, 2–10% medium, over
 * 10% high; cells with fewer than 3 aircraft are dropped. This is the
 * same formula and bands the live GNSS Integrity layer borrows — the
 * difference is the evidence: a published 24-hour aggregate per cell
 * here, a rolling 30-minute snapshot of visited views there.
 *
 * Green cells are shown, not hidden: with ~13 cells there is no
 * clutter, and hiding them would confuse "all clear" with "no data".
 *
 * A medium/high cell is a navigation-integrity anomaly, exactly as in
 * the live layer: red and yellow hexes show where aircraft reported
 * low navigation accuracy. That is NOT proof of jamming or spoofing —
 * avionics faults and military trainers also report low values — and
 * the layer must never present it as a detection.
 */

/** Cape May County box the proxy covers. */
export const GPSJAM_BOX = Object.freeze({
  latMin: 38.9,
  latMax: 39.35,
  lonMin: -75.15,
  lonMax: -74.55,
});
/** Margin around the county box, in degrees — res-4 cells are ~26 km across. */
export const GPSJAM_MARGIN_DEG = 0.5;
/** Hide sparse one- and two-aircraft cells; the score separately discounts one bad report. */
export const GPSJAM_MIN_AIRCRAFT = 3;
/** gpsjam.org band edges, in percent of aircraft (after discounting one). */
export const GPSJAM_MEDIUM_PERCENT = 2;
export const GPSJAM_HIGH_PERCENT = 10;

/** Primary cell state: what the data shows (low navigation accuracy). */
export const GPSJAM_ANOMALY_STATE = 'navigation-integrity-anomaly';
export const GPSJAM_NOMINAL_STATE = 'nominal';
/** Secondary, unvalidated reading of an anomaly cell. */
export const GPSJAM_INTERPRETATION = 'suspected-gnss-interference';

/** Legend colors: gpsjam's green / amber / red convention. */
export const GPSJAM_LEVEL_COLORS = Object.freeze({
  low: '#3fb950',
  medium: '#e3b341',
  high: '#f85149',
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_PATTERN = /^[0-9a-f]{15}$/;

/**
 * Navigation-integrity level of a cell, using gpsjam.org's published
 * cell formula and bands: the first bad aircraft is discounted to
 * limit false positives, then under 2% is low, 2–10% medium and over
 * 10% high. Medium and high cells are navigation-integrity anomalies.
 * The band reads the raw percent; the displayed percent is rounded.
 */
export function gpsjamIntegrityLevel(total, bad) {
  const percent = total > 0 ? (100 * Math.max(0, bad - 1)) / total : 0;
  const level =
    percent > GPSJAM_HIGH_PERCENT
      ? 'high'
      : percent >= GPSJAM_MEDIUM_PERCENT
        ? 'medium'
        : 'low';
  const anomaly = level !== 'low';
  return {
    percent: Math.round(percent * 10) / 10,
    level,
    state: anomaly ? GPSJAM_ANOMALY_STATE : GPSJAM_NOMINAL_STATE,
    interpretation: anomaly ? GPSJAM_INTERPRETATION : null,
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function validBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) return null;
  const vertices = [];
  for (const point of boundary) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lon = finiteNumber(point[0]);
    const lat = finiteNumber(point[1]);
    if (lon == null || lat == null) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    vertices.push([lon, lat]);
  }
  return vertices;
}

/**
 * Normalize one proxy cell into a display row, or null when it is not
 * a countable in-scope cell. Never throws. The level is re-derived
 * from the aircraft counts; the proxy's own level is ignored.
 */
export function normalizeGpsjamCell(cell) {
  if (!cell || typeof cell !== 'object') return null;
  const hex = typeof cell.hex === 'string' ? cell.hex : '';
  if (!HEX_PATTERN.test(hex)) return null;
  const lat = finiteNumber(cell.lat);
  const lon = finiteNumber(cell.lon);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const boundary = validBoundary(cell.boundary);
  if (!boundary) return null;
  const good = nonNegativeInt(cell.good);
  const bad = nonNegativeInt(cell.bad);
  if (good == null || bad == null) return null;
  const total = good + bad;
  if (total < GPSJAM_MIN_AIRCRAFT) return null;
  const { percent, level, state, interpretation } = gpsjamIntegrityLevel(
    total,
    bad,
  );
  return {
    hex,
    lat,
    lon,
    boundary,
    good,
    bad,
    total,
    percent,
    level,
    state,
    interpretation,
  };
}

/**
 * Normalize a proxy payload into display rows.
 *
 * Proxy payload: `{ date, source, suspect, fetchedAt, stale, ttlMs,
 * worldRows, count, cells: [<cell>] }` — see server/providers/gpsjam.js.
 *
 * Returns `{ date, source, suspect, stale, fetchedAt, cells, counts,
 * totalAircraft, totalBad }` or null when the payload is malformed.
 * `cells` are sorted by hex; duplicate hexes collapse to the first
 * (the proxy never sends duplicates, but a replayed or hand-built
 * payload might). `source` is the manifest's `source` column
 * (`adsbexchange` or `merged`); `suspect` is its suspect flag, true
 * when gpsjam.org flags the day as incomplete.
 */
export function normalizeGpsjamSnapshot(payload, { now = Date.now() } = {}) {
  void now;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (typeof payload.date !== 'string' || !DATE_PATTERN.test(payload.date))
    return null;
  if (!Array.isArray(payload.cells)) return null;
  const byHex = new Map();
  for (const cell of payload.cells) {
    const row = normalizeGpsjamCell(cell);
    if (!row) continue;
    if (!byHex.has(row.hex)) byHex.set(row.hex, row);
  }
  const cells = [...byHex.values()].sort((a, b) => a.hex.localeCompare(b.hex));
  const counts = { low: 0, medium: 0, high: 0 };
  let totalAircraft = 0;
  let totalBad = 0;
  for (const cell of cells) {
    counts[cell.level] += 1;
    totalAircraft += cell.total;
    totalBad += cell.bad;
  }
  return {
    date: payload.date,
    source:
      typeof payload.source === 'string' && payload.source !== ''
        ? payload.source
        : null,
    suspect: payload.suspect === true,
    stale: payload.stale === true,
    fetchedAt: Number.isFinite(payload.fetchedAt) ? payload.fetchedAt : null,
    cells,
    counts,
    totalAircraft,
    totalBad,
  };
}
