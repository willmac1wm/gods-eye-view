/**
 * OpenStreetMap surveillance-camera records (CCTV locations, NOT live feeds).
 *
 * The query is deliberately broad — every `man_made=surveillance` feature in
 * the viewport — and the camera-vs-other split happens here, because it needs
 * two keys (`surveillance` + `surveillance:type`) and the ALPR exclusion.
 * ALPR-typed features belong to the `alpr-cameras` layer and are dropped
 * here so the two layers never double-plot a camera.
 *
 * Live county verification 2026-11-16 (Overpass, bbox lat 38.90–39.35,
 * lon −75.15–−74.55): 2 camera-type features — node 13116656753
 * (38.9326358, −74.9230437, bare `surveillance:type=camera` tags) and node
 * 14077264754 (39.0346601, −74.7705174, fixed pole camera, parking zone,
 * direction 300). A full `man_made=surveillance` census was not completed
 * (Overpass 502'd on three attempts as the public instance saturated);
 * the record rule below is decided and does not depend on the census.
 */

/**
 * Whether a `surveillance:type` value denotes a camera. OSM allows
 * semicolon multi-values (`camera;ALPR`) and mixed case, so an exact match
 * would silently miss tagged cameras.
 * @param {*} value - raw `surveillance:type` tag value
 * @returns {boolean}
 */
export function isCameraSurveillanceType(value) {
  return String(value ?? '')
    .split(';')
    .some((part) => part.trim().toUpperCase() === 'CAMERA');
}

/**
 * Whether a `surveillance:type` value denotes an ALPR camera. Same
 * semicolon-aware match as the ALPR layer's `isAlprSurveillanceType`;
 * duplicated here so this layer never imports the ALPR layer's records.
 * @param {*} value - raw `surveillance:type` tag value
 * @returns {boolean}
 */
export function isAlprSurveillanceType(value) {
  return String(value ?? '')
    .split(';')
    .some((part) => part.trim().toUpperCase() === 'ALPR');
}

/**
 * Whether an element's tags describe a CCTV camera location for this layer:
 * camera-like and not ALPR. Anything else (`guard`, `outdoor`, `alarm`,
 * …) is dropped — this layer is CCTV locations, not a general surveillance
 * inventory.
 * @param {object} tags - raw OSM tags
 * @returns {boolean}
 */
export function isSurveillanceCamera(tags) {
  if (!tags || typeof tags !== 'object') return false;
  if (isAlprSurveillanceType(tags['surveillance:type'])) return false;
  return (
    isCameraSurveillanceType(tags['surveillance:type']) ||
    String(tags.surveillance ?? '')
      .split(';')
      .some((part) => part.trim().toLowerCase() === 'camera')
  );
}

function textTag(value) {
  const t = String(value ?? '').trim();
  return t || null;
}

function numTag(value) {
  // `Number('')` and `Number('   ')` are 0, not NaN — a blank or whitespace-only
  // tag value must read as missing, never as a due-north bearing.
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeDirection(value) {
  const degrees = numTag(value);
  return degrees != null && degrees >= 0 && degrees <= 360
    ? degrees % 360
    : null;
}

/**
 * Map one raw Overpass element to a plain camera record. Null for anything
 * unusable. Nodes use their own coordinates; ways use `center` (`out
 * center` in the query). Non-camera and ALPR features are dropped.
 * @param {object} el - raw Overpass element
 * @returns {object|null}
 */
export function normalizeSurveillanceElement(el) {
  if (!el || (el.type !== 'node' && el.type !== 'way')) return null;
  if (!Number.isSafeInteger(el.id) || el.id <= 0) return null;
  const lat = el.type === 'node' ? el.lat : el.center?.lat;
  const lon = el.type === 'node' ? el.lon : el.center?.lon;
  if (
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  )
    return null;
  const tags = el.tags || {};
  if (!isSurveillanceCamera(tags)) return null;
  return {
    id: `surv:${el.id}`,
    osmId: el.id,
    latitude: lat,
    longitude: lon,
    operator: textTag(tags.operator),
    manufacturer: textTag(tags.manufacturer),
    cameraType: textTag(tags['camera:type']),
    zone: textTag(tags['surveillance:zone']),
    // Only numeric bearings are parsed; compass-word directions ("N"/"NE")
    // are rare on this tag and simply render with no facing line.
    directionDeg: normalizeDirection(
      tags['camera:direction'] ?? tags.direction,
    ),
    ref: textTag(tags.ref),
    lastVerified: textTag(tags.check_date) || textTag(tags['survey:date']),
    source: textTag(tags.source),
  };
}

/**
 * Overpass QL for the viewport. The server-side filter is intentionally
 * just `man_made=surveillance`: the camera/ALPR split needs two keys and
 * lives in `isSurveillanceCamera` above. Exported so the query shape is
 * pinnable.
 */
export function buildOverpassQuery(south, west, north, east) {
  return (
    `[out:json][timeout:20];` +
    `(node["man_made"="surveillance"](${south},${west},${north},${east});` +
    `way["man_made"="surveillance"](${south},${west},${north},${east}););` +
    `out center tags;`
  );
}

/** Validate a source-independent snapshot before replacing the accepted display. */
export function validateSurveillanceSnapshot(snapshot) {
  if (
    !Array.isArray(snapshot?.records) ||
    typeof snapshot.stale !== 'boolean' ||
    typeof snapshot.saturated !== 'boolean'
  ) {
    throw new TypeError('Camera source returned an invalid snapshot');
  }
  const ids = new Set();
  for (const record of snapshot.records) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !record.id.trim() ||
      ids.has(record.id) ||
      !Number.isFinite(record.latitude) ||
      Math.abs(record.latitude) > 90 ||
      !Number.isFinite(record.longitude) ||
      Math.abs(record.longitude) > 180 ||
      (record.directionDeg != null &&
        (!Number.isFinite(record.directionDeg) ||
          record.directionDeg < 0 ||
          record.directionDeg >= 360))
    ) {
      throw new TypeError('Camera source returned an invalid record');
    }
    ids.add(record.id);
  }
  return snapshot;
}
