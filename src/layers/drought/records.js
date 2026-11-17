/**
 * Drought records: U.S. Drought Monitor categories + point-in-polygon.
 *
 * Live verification 2026-11-16:
 * - `GET https://droughtmonitor.unl.edu/data/json/usdm_current.json`
 *   → HTTP 200, 5 features (one per DM category 0–4, national
 *   polygons). `Last-Modified: Thu, 12 Nov 2026 11:15:51 GMT` — the map
 *   is released weekly on Thursdays.
 * - Point-in-polygon (ray-casting) for the county seat (−74.90, 39.08):
 *   inside the DM 0 polygon only → **Cape May County is D0 — Abnormally
 *   Dry** on the current map. Atlantic City is also D0; Trenton and
 *   Newark are in no drought polygon at all.
 * - The `/data/geojson/usdm_current.geojson` path 404s — use the
 *   `/data/json/usdm_current.json` path.
 */
export const DROUGHT_CATEGORIES = Object.freeze({
  0: Object.freeze({
    code: 'D0',
    name: 'Abnormally Dry',
    description:
      'Going into drought: short-term dryness slowing planting, growth of crops or pastures.',
  }),
  1: Object.freeze({
    code: 'D1',
    name: 'Moderate Drought',
    description:
      'Some damage to crops, pastures; streams, reservoirs, or wells low; some water shortages developing or imminent.',
  }),
  2: Object.freeze({
    code: 'D2',
    name: 'Severe Drought',
    description:
      'Crop or pasture losses likely; water shortages common; water restrictions imposed.',
  }),
  3: Object.freeze({
    code: 'D3',
    name: 'Extreme Drought',
    description:
      'Major crop/pasture losses; widespread water shortages or restrictions.',
  }),
  4: Object.freeze({
    code: 'D4',
    name: 'Exceptional Drought',
    description:
      'Exceptional and widespread crop/pasture losses; shortages of water in reservoirs, streams, and wells creating water emergencies.',
  }),
});

/** Ray-casting point-in-ring test. `point` is { lat, lon }; `ring` is [[lon, lat], …]. */
export function pointInRing(point, ring) {
  if (!point || !Array.isArray(ring) || ring.length < 3) return false;
  const { lon: x, lat: y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y) {
      const xIntersect = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xIntersect) inside = !inside;
    }
  }
  return inside;
}

/** Whether a GeoJSON Polygon or MultiPolygon geometry contains the point (holes excluded). */
export function geometryContainsPoint(geometry, point) {
  if (!geometry || typeof geometry !== 'object') return false;
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    if (!pointInRing(point, polygon[0])) continue;
    let inHole = false;
    for (let r = 1; r < polygon.length; r++) {
      if (pointInRing(point, polygon[r])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * The DM category (0–4) of the feature containing the point, or null
 * when the point is in no drought polygon (no drought).
 */
export function categoryAtPoint(features, point) {
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const dm = feature?.properties?.DM;
    if (!Number.isInteger(dm) || dm < 0 || dm > 4) continue;
    if (geometryContainsPoint(feature.geometry, point)) return dm;
  }
  return null;
}

/**
 * County drought from a list of sample points: the worst (max) category
 * found, plus the per-point breakdown. A county straddling two
 * categories shows both — never a single number that hides the split.
 * @param {Array} features - USDM GeoJSON features
 * @param {Array} samplePoints - [{ lat, lon }, …]
 * @returns {{category: number|null, categories: Array<{point: object, category: number|null}>}}
 */
export function countyDrought(features, samplePoints) {
  const categories = (Array.isArray(samplePoints) ? samplePoints : []).map(
    (point) => ({ point, category: categoryAtPoint(features, point) }),
  );
  let worst = null;
  for (const entry of categories) {
    if (entry.category != null && (worst == null || entry.category > worst))
      worst = entry.category;
  }
  return { category: worst, categories };
}

/**
 * Validate a provider snapshot before it can replace the displayed card.
 * `category` may be null (no drought anywhere in the county) — that is
 * a valid result, not an error.
 */
export function validateDroughtSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    typeof snapshot.stale !== 'boolean' ||
    !(
      snapshot.category == null ||
      (Number.isInteger(snapshot.category) &&
        snapshot.category >= 0 &&
        snapshot.category <= 4)
    ) ||
    !Array.isArray(snapshot.categories)
  ) {
    throw new TypeError('Drought source returned an invalid snapshot');
  }
  return snapshot;
}
