/**
 * Radiation records: EPA RadNet CDX CSV + Safecast crowd measurements.
 *
 * Live verification 2026-11-16:
 * - `GET radnet.epa.gov/cdx-radnet-rest/api/rest/csv/2026/fixed/nj/edison`
 *   → HTTP 200, 686,782 bytes, 6,900 lines (2026 YTD). Latest row:
 *   `NJ: EDISON, 11/16/2026 21:42:00, 39.00 nSv/h, R02 1348 CPM, …,
 *   APPROVED`.
 * - `GET …/csv/2026/fixed/pa/philadelphia` → HTTP 200, 800,756 bytes.
 *   Latest row: `PA: PHILADELPHIA, 11/16/2026 21:39:00, 41.00 nSv/h,
 *   R02 1438 CPM, …, APPROVED`.
 * - Both monitors report hourly; typical background is ~30–60 nSv/h —
 *   both are in normal background today. Times are UTC; display in ET.
 * - Safecast (`api.safecast.org/measurements.json`) → HTTP 200, but the
 *   nearest measurements within 200 km are 2017 Maryland rows (17–26
 *   cpm). ⚠️ The `distance` parameter is in METERS, not kilometres
 *   (proven: distance=100/250 returned [], distance=50000 near Tokyo
 *   returned rows). Safecast is a supplement only, never the headline.
 */

function numValue(value) {
  // Number(null) is 0 and Number('') is 0 — a missing reading must stay
  // missing, never become a fabricated zero.
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/** Haversine distance in kilometres between two { lat, lon } points. */
export function distanceKm(a, b) {
  if (
    !a ||
    !b ||
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lon) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lon)
  )
    return null;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The only RadNet row status the card trusts. */
const RADNET_APPROVED = 'APPROVED';

/**
 * Parse a RadNet CDX CSV (one monitor, one year) and return the last
 * APPROVED row: { locationName, sampleTime, doseRateNSvH, gammaCpmR02,
 * status }. The CSV header is:
 * LOCATION_NAME,SAMPLE COLLECTION TIME,DOSE EQUIVALENT RATE (nSv/h),
 * GAMMA COUNT RATE R02..R09 (CPM),STATUS
 * Sample times are MM/DD/YYYY HH:MM:SS in UTC. Returns null when no
 * APPROVED row exists.
 * @param {string} csv - raw CSV text
 * @returns {object|null}
 */
export function parseRadnetCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) return null;
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map((cell) => cell.trim());
  const timeIdx = header.indexOf('SAMPLE COLLECTION TIME');
  const doseIdx = header.indexOf('DOSE EQUIVALENT RATE (nSv/h)');
  const r02Idx = header.indexOf('GAMMA COUNT RATE R02 (CPM)');
  const statusIdx = header.indexOf('STATUS');
  if (timeIdx < 0 || doseIdx < 0 || r02Idx < 0 || statusIdx < 0) return null;
  let last = null;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length <= Math.max(timeIdx, doseIdx, r02Idx, statusIdx)) continue;
    if (textValue(cells[statusIdx]) !== RADNET_APPROVED) continue;
    const dose = numValue(cells[doseIdx]);
    if (dose == null) continue;
    const sampleTime = parseRadnetTime(textValue(cells[timeIdx]));
    if (!sampleTime) continue;
    last = {
      locationName: textValue(cells[0]),
      sampleTime,
      doseRateNSvH: dose,
      gammaCpmR02: numValue(cells[r02Idx]),
      status: RADNET_APPROVED,
    };
  }
  return last;
}

/** "11/16/2026 21:42:00" (UTC) → ISO string, or null. */
export function parseRadnetTime(value) {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Normalize one Safecast measurement row to { value, unit, lat, lon,
 * capturedAt }. Null for anything unusable.
 */
export function normalizeSafecastMeasurement(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const value = numValue(row.value);
  const lat = numValue(row.latitude);
  const lon = numValue(row.longitude);
  if (value == null || lat == null || lon == null) return null;
  return {
    value,
    unit: textValue(row.unit),
    lat,
    lon,
    capturedAt: textValue(row.captured_at),
  };
}

/**
 * Validate a provider snapshot before it can replace the displayed card.
 * At least one monitor reading is required; the Safecast half may be null.
 */
export function validateRadiationSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    typeof snapshot.stale !== 'boolean' ||
    !Array.isArray(snapshot.monitors) ||
    snapshot.monitors.length === 0 ||
    !snapshot.monitors.every(
      (monitor) =>
        monitor &&
        typeof monitor.key === 'string' &&
        Number.isFinite(monitor.doseRateNSvH) &&
        typeof monitor.sampleTime === 'string',
    )
  ) {
    throw new TypeError('Radiation source returned an invalid snapshot');
  }
  return snapshot;
}
