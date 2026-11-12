/**
 * Shared camera numbers for the long hash (`#v=2&lat=…`) and the view API.
 * Pure: no DOM, no Cesium. A null-island fix (0, 0) is not a place anyone
 * aimed the camera; it is what a missing query parameter becomes, so it falls
 * back to the Cape May startup view instead of being flown or written.
 */

/** Settled startup camera over Cape May City. Pitch stays off exact nadir. */
export const CAPE_MAY_STARTUP_VIEW = Object.freeze({
  lat: 38.935,
  lon: -74.91,
  alt: 45000,
  heading: 0,
  pitch: -89,
  roll: 0,
});

/** High approach used before the settled startup flight. */
export const CAPE_MAY_APPROACH_ALT_M = 150000;

export const MIN_CAMERA_ALT_M = 30;
export const MAX_CAMERA_ALT_M = 40_000_000;

/** Just shy of straight down, so the view direction is not parallel to up. */
export const NADIR_PITCH_DEG = -89;

const BLOOM_INTENSITY_MAX = 200;
const SHARPEN_INTENSITY_MAX = 100;
const BLOOM_VERSION_MAX = 2;

/** A finite number, or null. Rejects NaN, Infinity, and non-numeric text. */
export function finiteNumber(value) {
  // Number(null) is 0. A missing coordinate must stay missing, not null island.
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** True for +0 and -0, the null island a missing coordinate becomes. */
export function isNullIsland(lat, lon) {
  return lat === 0 && lon === 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Heading in degrees, wrapped into [0, 360). 360 becomes 0. */
export function normalizeHeadingDeg(value, fallback = 0) {
  const numeric = finiteNumber(value);
  const degrees = numeric == null ? fallback : numeric;
  return ((degrees % 360) + 360) % 360;
}

/** Pitch in degrees, clamped to [-90, 0]. */
export function clampPitchDeg(value, fallback = -35) {
  const numeric = finiteNumber(value);
  return clamp(numeric == null ? fallback : numeric, -90, 0);
}

/**
 * Pitch for a Cesium setView. Exact nadir is nudged off the singularity
 * where the camera direction and the up vector are parallel.
 */
export function normalizePitchDeg(value, fallback = -35) {
  const degrees = clampPitchDeg(value, fallback);
  return degrees <= -90 ? NADIR_PITCH_DEG : degrees;
}

export function normalizeRollDeg(value, fallback = 0) {
  const numeric = finiteNumber(value);
  if (numeric == null) return fallback;
  // 360 is a full turn the long-form links already write; the share codec
  // folds it to 0. Values past one turn are wrapped into [-180, 180].
  if (numeric >= -360 && numeric <= 360) return numeric;
  let degrees = ((numeric % 360) + 360) % 360;
  if (degrees > 180) degrees -= 360;
  return degrees;
}

export function normalizeAltitudeM(value, fallback = CAPE_MAY_STARTUP_VIEW.alt) {
  const numeric = finiteNumber(value);
  return clamp(numeric == null ? fallback : numeric, MIN_CAMERA_ALT_M, MAX_CAMERA_ALT_M);
}

/** Integer setting in [min, max]. Non-numeric values use `fallback`. */
export function clampIntSetting(value, min, max, fallback) {
  const numeric = finiteNumber(value);
  if (numeric == null) return fallback;
  return clamp(Math.round(numeric), min, max);
}

export function normalizeBloomIntensity(value, fallback = 0) {
  return clampIntSetting(value, 0, BLOOM_INTENSITY_MAX, fallback);
}

export function normalizeBloomVersion(value, fallback = 1) {
  return clampIntSetting(value, 1, BLOOM_VERSION_MAX, fallback);
}

export function normalizeSharpenIntensity(value, fallback = 49) {
  return clampIntSetting(value, 0, SHARPEN_INTENSITY_MAX, fallback);
}

/**
 * A camera that is safe to fly and to write. Null when latitude or longitude
 * is missing or not finite. Null island is replaced with the Cape May view.
 * @param {{lat?: unknown, lon?: unknown, alt?: unknown, heading?: unknown, pitch?: unknown, roll?: unknown}} raw
 * @returns {{lat: number, lon: number, alt: number, heading: number, pitch: number, roll: number}|null}
 */
export function normalizeSharedCamera(raw) {
  const lat = finiteNumber(raw?.lat);
  const lon = finiteNumber(raw?.lon);
  if (lat == null || lon == null) return null;
  if (isNullIsland(lat, lon)) return { ...CAPE_MAY_STARTUP_VIEW };
  return {
    lat: clamp(lat, -90, 90),
    lon: clamp(lon, -180, 180),
    // 800 matches the long-hash parser's historical missing-alt fallback.
    alt: normalizeAltitudeM(raw.alt, 800),
    heading: normalizeHeadingDeg(raw.heading, 0),
    pitch: clampPitchDeg(raw.pitch, -35),
    roll: normalizeRollDeg(raw.roll, 0),
  };
}

/**
 * Degrees that would print as 0.0000 / -0.0000. Those are null island, not a
 * real aim point, and must not be written into the address.
 */
export function formatsAsNullIsland(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  return Number(lat.toFixed(4)) === 0 && Number(lon.toFixed(4)) === 0;
}
