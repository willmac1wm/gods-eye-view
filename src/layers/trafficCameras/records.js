/**
 * Live traffic-camera records: NJDOT 511 + DelDOT TMC/ArcGIS + DRBA ferry
 * webcams, merged into one pin set.
 *
 * Live county verification 2026-11-16:
 * - `GET https://511nj.org/api/GetCameras?format=json` (no key) → HTTP 401
 *   (endpoint exists; the key is the gate). Without NJ511_API_KEY the
 *   provider answers 200 { configured: false, cameras: [] }.
 * - `GET https://tmc.deldot.gov/json/videocamera.json` → HTTP 200, 189,639
 *   bytes — DelDOT live now, keyless.
 *
 * Unified row (both providers already map to this shape server-side):
 * { name, image_url, road, lat, lng, heading, fov, heading_confidence,
 *   source, extra }. The client only validates + dedupes; it never
 *   re-fetches an upstream.
 */

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function numValue(value) {
  // Number(null) is 0 and Number('') is 0 — a missing reading must stay
  // missing, never become a fabricated zero.
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Map one provider camera row to a plain camera record. Null for anything
 * unusable (missing/invalid coordinates). The id is stable per source so
 * the NJ511 and DelDOT halves never double-plot the same physical camera
 * under two ids.
 * @param {object} row - raw provider camera row
 * @returns {object|null}
 */
export function normalizeTrafficCamera(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const lat = numValue(row.lat);
  const lng = numValue(row.lng);
  if (lat == null || Math.abs(lat) > 90 || lng == null || Math.abs(lng) > 180)
    return null;
  const source = textValue(row.source) ?? 'unknown';
  const extraId = row.extra?.id ?? row.extra?.ID ?? null;
  const stableId =
    extraId != null
      ? `${source}:${String(extraId)}`
      : `${source}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const heading = numValue(row.heading);
  return {
    id: stableId,
    name: textValue(row.name) ?? 'Traffic camera',
    imageUrl: textValue(row.image_url),
    playerUrl: textValue(row.player_url),
    streamUrl: textValue(row.stream_url),
    road: textValue(row.road),
    lat,
    lng,
    heading:
      heading != null && heading >= 0 && heading < 360 ? heading % 360 : null,
    fov: numValue(row.fov) ?? 60,
    headingConfidence: textValue(row.heading_confidence),
    source,
  };
}

/**
 * Merge the two provider camera lists into one deduped snapshot.
 * NJ511 wins a duplicate id (its feed is the fresher one when configured).
 * @param {Array} nj511Cameras - rows from /api/nj511
 * @param {Array} deldotCameras - rows from /api/deldot-cameras
 * @returns {{records: Array, nj511Count: number, deldotCount: number}}
 */
export function mergeTrafficCameras(nj511Cameras, deldotCameras) {
  const byId = new Map();
  const deldot = (Array.isArray(deldotCameras) ? deldotCameras : [])
    .map(normalizeTrafficCamera)
    .filter(Boolean);
  for (const record of deldot) byId.set(record.id, record);
  const nj511 = (Array.isArray(nj511Cameras) ? nj511Cameras : [])
    .map(normalizeTrafficCamera)
    .filter(Boolean);
  for (const record of nj511) byId.set(record.id, record);
  return {
    records: [...byId.values()],
    nj511Count: nj511.length,
    deldotCount: deldot.length,
  };
}

/**
 * Validate a merged snapshot before it can replace the displayed pins.
 * @param {*} snapshot - merged snapshot
 * @returns {object} the snapshot, unchanged
 */
export function validateTrafficSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    !Array.isArray(snapshot.records) ||
    typeof snapshot.nj511Configured !== 'boolean' ||
    typeof snapshot.stale !== 'boolean'
  ) {
    throw new TypeError('Traffic cameras source returned an invalid snapshot');
  }
  const ids = new Set();
  for (const record of snapshot.records) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !record.id.trim() ||
      ids.has(record.id) ||
      !Number.isFinite(record.lat) ||
      Math.abs(record.lat) > 90 ||
      !Number.isFinite(record.lng) ||
      Math.abs(record.lng) > 180
    ) {
      throw new TypeError('Traffic cameras source returned an invalid record');
    }
    ids.add(record.id);
  }
  return snapshot;
}
