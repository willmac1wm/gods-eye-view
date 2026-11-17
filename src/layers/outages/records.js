/**
 * Validate MassOutage county/areas/alerts payloads before they can replace
 * the displayed outage snapshot. Whole-payload rejection (return null)
 * mirrors normalizeEarthquakeSnapshot: a malformed payload never partially
 * overwrites good data. Masked counts ("<N") are unknown, never 0.
 */

export const OUTAGES_COUNTY_FIPS = '34009';
/** County-seat centroid for the county summary overlay label. */
export const OUTAGES_COUNTY_CENTER = Object.freeze({
  lat: 39.0827,
  lon: -74.82,
});

function finiteNumber(value) {
  // Number('') is 0 and Number('<10') is NaN; a masked count string must
  // be rejected explicitly — an unknown count is not a 0 count.
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(value) ? value : null;
}

function optionalFinite(value) {
  if (value == null || value === '') return null;
  return finiteNumber(value);
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function timeMsOrNull(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTrend(trend) {
  if (!trend || typeof trend !== 'object' || Array.isArray(trend)) return null;
  const direction = textOrNull(trend.direction);
  if (
    direction != null &&
    !['rising', 'steady', 'improving'].includes(direction)
  )
    return null;
  return {
    direction,
    durationMin: optionalFinite(trend.duration_min),
    peakOut: optionalFinite(trend.peak_out),
    normalcy: textOrNull(trend.normalcy),
    vsRecordPct: optionalFinite(trend.vs_record_pct),
  };
}

function normalizeUtility(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const name = textOrNull(entry.name);
  const customersOut = finiteNumber(entry.customers_out);
  if (name == null || customersOut == null) return null;
  return {
    id: textOrNull(entry.id),
    name,
    customersOut,
    etr: textOrNull(entry.etr),
    etrMs: timeMsOrNull(entry.etr),
  };
}

/**
 * County live payload: {"data":{"fips","customers_out","customers_tracked",
 * "pct","incident_count","utilities":[{"id","name","customers_out","etr"}],
 * "worst_etr","updated_at","as_of","trend":{...}},"meta":{"live":{...}}}
 * Returns the normalized county snapshot, or null when malformed.
 */
export function normalizeOutageCounty(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.error != null) return null;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const fips = textOrNull(data.fips);
  const customersOut = finiteNumber(data.customers_out);
  const customersTracked = finiteNumber(data.customers_tracked);
  const pct = finiteNumber(data.pct);
  const incidentCount = finiteNumber(data.incident_count);
  if (
    fips == null ||
    customersOut == null ||
    customersTracked == null ||
    pct == null ||
    incidentCount == null
  )
    return null;
  if (!Array.isArray(data.utilities)) return null;
  const utilities = [];
  for (const entry of data.utilities) {
    const utility = normalizeUtility(entry);
    if (!utility) return null;
    utilities.push(utility);
  }
  const metaLive =
    payload.meta &&
    typeof payload.meta === 'object' &&
    !Array.isArray(payload.meta)
      ? payload.meta.live
      : null;
  return {
    fips,
    customersOut,
    customersTracked,
    pct,
    incidentCount,
    utilities,
    worstEtr: textOrNull(data.worst_etr),
    worstEtrMs: timeMsOrNull(data.worst_etr),
    updatedAt: textOrNull(data.updated_at),
    asOf: textOrNull(data.as_of),
    asOfMs: timeMsOrNull(data.as_of),
    trend: normalizeTrend(data.trend),
    liveStatus: textOrNull(metaLive?.status),
    liveNotice: textOrNull(metaLive?.notice),
  };
}

/**
 * Areas payload: {"data":[{"utility_key","utility_name","area_type","name",
 * "customers_served","customers_out","masked_outages","incident_count",
 * "etr","bbox":[w,s,e,n],"as_of","pct_out"}],"as_of":"..."}
 * Returns normalized per-municipality rows (bbox center included), or null
 * when malformed. An empty data array is valid — it means no town is
 * affected right now. Rows with masked counts keep customersOut null.
 */
export function normalizeOutageAreas(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.error != null) return null;
  const data = payload.data;
  if (!Array.isArray(data)) return null;
  const rows = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const name = textOrNull(entry.name);
    const customersServed = finiteNumber(entry.customers_served);
    if (name == null || customersServed == null) return null;
    const bbox = entry.bbox;
    if (
      !Array.isArray(bbox) ||
      bbox.length !== 4 ||
      bbox.some((v) => !Number.isFinite(v))
    )
      return null;
    const [west, south, east, north] = bbox;
    if (
      Math.abs(west) > 180 ||
      Math.abs(east) > 180 ||
      Math.abs(south) > 90 ||
      Math.abs(north) > 90 ||
      west >= east ||
      south >= north
    )
      return null;
    rows.push({
      name,
      utilityKey: textOrNull(entry.utility_key),
      utilityName: textOrNull(entry.utility_name),
      areaType: textOrNull(entry.area_type),
      customersServed,
      customersOut: optionalFinite(entry.customers_out),
      maskedOutages: optionalFinite(entry.masked_outages),
      incidentCount: optionalFinite(entry.incident_count),
      etr: textOrNull(entry.etr),
      etrMs: timeMsOrNull(entry.etr),
      bbox: { west, south, east, north },
      lat: (south + north) / 2,
      lon: (west + east) / 2,
      asOf: textOrNull(entry.as_of),
      asOfMs: timeMsOrNull(entry.as_of),
      pctOut: optionalFinite(entry.pct_out),
    });
  }
  return rows;
}

/**
 * Alerts payload: {"data":{"fips","thresholds":{"major_event_pct":10},
 * "county":{"customers_out","pct_out","above_threshold"},
 * "utilities":[{"utility_key","name","connector_status","customers_out",
 * "customers_served","pct_out","above_threshold","major_event","visible"}],
 * "areas_above_threshold":[],"as_of":"..."}}
 * Returns the normalized threshold evaluation, or null when malformed.
 * Never call a utility "clear" unless its connector_status is "county"
 * or "utility" with visible true — that rule lives here, not in the panel.
 */
export function normalizeOutageAlerts(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.error != null) return null;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const fips = textOrNull(data.fips);
  if (fips == null) return null;
  const county = data.county;
  if (!county || typeof county !== 'object' || Array.isArray(county))
    return null;
  const countyOut = finiteNumber(county.customers_out);
  if (countyOut == null) return null;
  if (!Array.isArray(data.utilities)) return null;
  const utilities = [];
  for (const entry of data.utilities) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const name = textOrNull(entry.name);
    const customersOut = finiteNumber(entry.customers_out);
    if (name == null || customersOut == null) return null;
    const status = textOrNull(entry.connector_status);
    utilities.push({
      utilityKey: textOrNull(entry.utility_key),
      name,
      connectorStatus: status,
      customersOut,
      customersServed: optionalFinite(entry.customers_served),
      pctOut: optionalFinite(entry.pct_out),
      aboveThreshold: entry.above_threshold === true,
      majorEvent: entry.major_event === true,
      // A utility is only "clear" when its connector is live for the
      // county (or the utility itself) and the feed marks it visible.
      clear:
        (status === 'county' || status === 'utility') &&
        entry.visible === true &&
        customersOut === 0,
      visible: entry.visible === true,
    });
  }
  const majorEventPct = finiteNumber(data.thresholds?.major_event_pct);
  return {
    fips,
    majorEventPct,
    county: {
      customersOut: countyOut,
      pctOut: optionalFinite(county.pct_out),
      aboveThreshold: county.above_threshold === true,
    },
    utilities,
    areasAboveThreshold: Array.isArray(data.areas_above_threshold)
      ? data.areas_above_threshold
          .map((area) => textOrNull(area))
          .filter((area) => area != null)
      : [],
    asOf: textOrNull(data.as_of),
    asOfMs: timeMsOrNull(data.as_of),
  };
}

/** True when any utility in the alerts evaluation is a major event (≥10%). */
export function hasMajorEvent(alerts) {
  if (!alerts || !Array.isArray(alerts.utilities)) return false;
  return alerts.utilities.some((utility) => utility.majorEvent === true);
}

/** Severity rank for a county or area pct_out: drives map color. */
export function severityForPct(pctOut) {
  if (!Number.isFinite(pctOut) || pctOut <= 0) return 'none';
  if (pctOut >= 10) return 'major';
  if (pctOut >= 5) return 'moderate';
  if (pctOut >= 1) return 'minor';
  return 'watch';
}
