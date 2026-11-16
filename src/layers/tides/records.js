/**
 * Validate CO-OPS payloads before they can replace the displayed tide
 * snapshot. Whole-payload rejection (return null) mirrors
 * normalizeEarthquakeSnapshot: a malformed payload never partially
 * overwrites good data. Per-gauge, the source drops the gauge instead of
 * the snapshot (see source.js).
 */

const TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function finiteNumber(value) {
  // Number('') is 0, so a blank string must be rejected explicitly — an
  // empty CO-OPS value is missing data, not a 0 ft reading.
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

/**
 * water_level payload:
 * {"metadata":{"id","name","lat","lon"},"data":[{"t","v","s","f","q"}]}
 * `v` is a numeric string in ft above the requested datum. `s` (sigma),
 * `f` (flags) and `q` (quality) are optional strings.
 * Returns { stationId, name, lat, lon, points: [{t, v, sigma, quality}] }
 * with points in payload order, or null when malformed / empty.
 */
export function normalizeWaterLevelPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.error != null) return null;
  const metadata = payload.metadata;
  const data = payload.data;
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    typeof metadata.id !== 'string' ||
    metadata.id === '' ||
    typeof metadata.name !== 'string' ||
    !Array.isArray(data) ||
    data.length === 0
  )
    return null;
  const lat = finiteNumber(metadata.lat);
  const lon = finiteNumber(metadata.lon);
  if (
    lat == null ||
    Math.abs(lat) > 90 ||
    lon == null ||
    Math.abs(lon) > 180
  )
    return null;
  const points = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    if (typeof entry.t !== 'string' || !TIME_PATTERN.test(entry.t))
      return null;
    const v = finiteNumber(entry.v);
    if (v == null) return null;
    points.push({
      t: entry.t,
      v,
      sigma: optionalFinite(entry.s),
      quality:
        typeof entry.q === 'string' && entry.q !== '' ? entry.q : null,
    });
  }
  return { stationId: metadata.id, name: metadata.name, lat, lon, points };
}

/**
 * predictions payload: {"predictions":[{"t","v","type"?}]} — no metadata.
 * `type` is "H"/"L" only on interval=hilo; 6-minute predictions omit it.
 * Returns [{t, v}] or null when malformed / empty.
 */
export function normalizePredictionsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.error != null) return null;
  const list = payload.predictions;
  if (!Array.isArray(list) || list.length === 0) return null;
  const points = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    if (typeof entry.t !== 'string' || !TIME_PATTERN.test(entry.t))
      return null;
    const v = finiteNumber(entry.v);
    if (v == null) return null;
    points.push({ t: entry.t, v });
  }
  return points;
}

/**
 * floodlevels payload: {nos_minor, nos_moderate, nos_major, nws_minor,
 * nws_moderate, nws_major, action}. Values are FEET ABOVE STATION DATUM
 * (verified 2026-11-15 — see PLAN.md §1.2); `action` may be null.
 * Returns { nos: {minor, moderate, major}, nws: {...} } or null.
 */
export function normalizeFloodLevels(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const read = (key) => {
    const n = finiteNumber(payload[key]);
    return n;
  };
  const nos = {
    minor: read('nos_minor'),
    moderate: read('nos_moderate'),
    major: read('nos_major'),
  };
  const nws = {
    minor: read('nws_minor'),
    moderate: read('nws_moderate'),
    major: read('nws_major'),
  };
  for (const v of [...Object.values(nos), ...Object.values(nws)])
    if (v == null) return null;
  if (!(nos.minor < nos.moderate && nos.moderate < nos.major)) return null;
  if (!(nws.minor < nws.moderate && nws.moderate < nws.major)) return null;
  return { nos, nws };
}

/**
 * datums payload: {units: "feet", datums: [{name, value}, ...]}.
 * Returns { mllwOffsetFt } — the MLLW value above station datum — or null.
 * Units MUST be feet: a metric payload would silently corrupt the
 * flood-threshold conversion, so it is rejected, not converted.
 */
export function normalizeDatums(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.units !== 'feet') return null;
  if (!Array.isArray(payload.datums)) return null;
  for (const datum of payload.datums) {
    if (datum?.name === 'MLLW') {
      const value = finiteNumber(datum.value);
      if (value == null) return null;
      return { mllwOffsetFt: value };
    }
  }
  return null;
}

/** Trend from the last two observed points; 0.02 ft dead band vs sigma noise. */
export function trendFromPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const diff = points[points.length - 1].v - points[points.length - 2].v;
  if (!Number.isFinite(diff)) return null;
  if (diff > 0.02) return 'rising';
  if (diff < -0.02) return 'falling';
  return 'steady';
}

/**
 * Combine one gauge's validated observed + prediction series into a
 * snapshot row (see PLAN.md §2.1). The prediction is matched on the
 * verbatim "t" string — both products share the lst_ldt clock. A missing
 * prediction for the latest timestamp yields predicted/residual null, never
 * an interpolated value. thresholds may be null (unknown station) — then
 * floodStage is 'none' and the threshold fields are null.
 */
export function buildGaugeRow({ gauge, observed, predictions, thresholds }) {
  if (!gauge || !observed || !Array.isArray(predictions)) return null;
  const latest = observed.points[observed.points.length - 1];
  if (!latest) return null;
  const predicted = predictions.find((p) => p.t === latest.t);
  const predictedFtMllw = predicted ? predicted.v : null;
  const residualFt =
    predictedFtMllw == null
      ? null
      : Math.round((latest.v - predictedFtMllw) * 1000) / 1000;
  return {
    stationId: String(gauge.id),
    name: observed.name || gauge.name,
    lat: observed.lat,
    lon: observed.lon,
    observedFtMllw: latest.v,
    observedTime: latest.t,
    predictedFtMllw,
    residualFt,
    floodStage: floodStageForLevel(latest.v, thresholds?.nws ?? null),
    trend: trendFromPoints(observed.points),
    sigmaFt: latest.sigma,
    quality: latest.quality,
    thresholdsMllw: thresholds?.nws ?? null,
    nosThresholdsMllw: thresholds?.nos ?? null,
  };
}

/** NWS-set classification. Boundaries inclusive: at the threshold, it counts. */
export function floodStageForLevel(levelFtMllw, thresholds) {
  if (!Number.isFinite(levelFtMllw) || !thresholds) return 'none';
  const { minor, moderate, major } = thresholds;
  if (![minor, moderate, major].every(Number.isFinite)) return 'none';
  if (levelFtMllw >= major) return 'major';
  if (levelFtMllw >= moderate) return 'moderate';
  if (levelFtMllw >= minor) return 'minor';
  return 'none';
}
