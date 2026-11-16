import { GAUGES_SITES_BY_ID } from './sites.js';

/**
 * Validate USGS Water Data API v1 latest-continuous payloads before they
 * can replace the displayed gauge snapshot. Whole-payload rejection
 * (return null) mirrors normalizeEarthquakeSnapshot: a malformed payload
 * never partially overwrites good data.
 *
 * OGC Features payload (f=json):
 * {"type":"FeatureCollection","features":[{"type":"Feature","properties":{
 *   "monitoring_location_id":"USGS-01411000","parameter_code":"00065",
 *   "time":"2026-11-16T16:00:00+00:00","value":"3.76",
 *   "unit_of_measure":"ft","approval_status":"Provisional",
 *   "qualifier":null,"statistic_id":"00011"}}]}
 *
 * Two v1 behaviors verified live 2026-11-16 and encoded here:
 * - Repeated query params do NOT batch (the API keeps the last value of
 *   each); comma-separated values DO batch — one call covers both sites
 *   and both parameters.
 * - A gauge can carry a duplicate EQUIP-qualified null reading at the
 *   same timestamp as the clean reading (01411300/00065 on 2026-11-16).
 *   The picker takes the newest non-EQUIP reading with a real value;
 *   an EQUIP-only series is missing data, never 0.
 *
 * Gage height is feet above GAGE DATUM, not NAVD88 — the layer labels it
 * as such; converting needs the published gage zero. All IV data is
 * provisional / subject to revision — surfaced, not hidden.
 */

export const GAUGES_STALE_AFTER_MS = 2 * 60 * 60_000;

function siteIdOf(locationId) {
  if (typeof locationId !== 'string') return null;
  const id = locationId.replace(/^USGS-/, '');
  return GAUGES_SITES_BY_ID[id] ? id : null;
}

function isEquip(qualifier) {
  if (qualifier == null) return false;
  const values = Array.isArray(qualifier) ? qualifier : [qualifier];
  return values.some(
    (value) =>
      typeof value === 'string' && value.trim().toLowerCase() === 'equip',
  );
}

function finiteValue(value) {
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(value) ? value : null;
}

function timeMsOrNull(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function pickReading(candidates) {
  // Newest first; skip EQUIP-qualified and valueless rows.
  const sorted = [...candidates].sort((a, b) => b.timeMs - a.timeMs);
  for (const candidate of sorted) {
    if (!isEquip(candidate.qualifier) && candidate.value != null)
      return candidate;
  }
  return null;
}

/**
 * Normalize one latest-continuous FeatureCollection into per-gauge rows.
 * Returns {gauges: [{siteId, name, shortName, lat, lon, discharge,
 * gageHeight, asOfMs}]} — discharge/gageHeight are null when the series
 * has no valid reading — or null when the payload is malformed or no
 * tracked site has any valid reading.
 */
export function normalizeUsgsLatestFeatures(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (!Array.isArray(payload.features)) return null;
  const bySiteParam = new Map();
  for (const feature of payload.features) {
    if (!feature || typeof feature !== 'object' || Array.isArray(feature))
      return null;
    const properties = feature.properties;
    if (!properties || typeof properties !== 'object') return null;
    const siteId = siteIdOf(properties.monitoring_location_id);
    if (siteId == null) continue; // untracked site: ignore
    const parameterCode = String(properties.parameter_code ?? '');
    if (parameterCode !== '00060' && parameterCode !== '00065') continue;
    const timeMs = timeMsOrNull(properties.time);
    if (timeMs == null) continue;
    const key = `${siteId}:${parameterCode}`;
    if (!bySiteParam.has(key)) bySiteParam.set(key, []);
    bySiteParam.get(key).push({
      timeMs,
      time: properties.time,
      value: finiteValue(properties.value),
      unit:
        typeof properties.unit_of_measure === 'string'
          ? properties.unit_of_measure
          : null,
      approvalStatus:
        typeof properties.approval_status === 'string'
          ? properties.approval_status
          : null,
      qualifier: properties.qualifier ?? null,
    });
  }
  const gauges = [];
  for (const site of Object.values(GAUGES_SITES_BY_ID)) {
    const discharge = pickReading(bySiteParam.get(`${site.id}:00060`) ?? []);
    const gageHeight = pickReading(bySiteParam.get(`${site.id}:00065`) ?? []);
    if (!discharge && !gageHeight) continue;
    const times = [discharge?.timeMs, gageHeight?.timeMs].filter(
      (ms) => ms != null,
    );
    gauges.push({
      siteId: site.id,
      name: site.name,
      shortName: site.shortName,
      lat: site.lat,
      lon: site.lon,
      discharge: discharge
        ? {
            value: discharge.value,
            unit: discharge.unit,
            time: discharge.time,
            timeMs: discharge.timeMs,
            approvalStatus: discharge.approvalStatus,
          }
        : null,
      gageHeight: gageHeight
        ? {
            value: gageHeight.value,
            unit: gageHeight.unit,
            time: gageHeight.time,
            timeMs: gageHeight.timeMs,
            approvalStatus: gageHeight.approvalStatus,
          }
        : null,
      asOfMs: times.length ? Math.max(...times) : null,
    });
  }
  if (gauges.length === 0) return null;
  return { gauges };
}

/** True when the gauge's newest reading is older than the 2-hour window. */
export function gaugeIsStale(asOfMs, nowMs = Date.now()) {
  if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) return true;
  return nowMs - asOfMs > GAUGES_STALE_AFTER_MS;
}
