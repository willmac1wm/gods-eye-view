/**
 * Space weather records: NOAA SWPC Kp, forecast, solar wind, IMF.
 *
 * Live verification 2026-11-16:
 * - Kp 1-min JSON (`services.swpc.noaa.gov/json/planetary_k_index_1m.json`)
 *   → HTTP 200, 358 rows; latest 2026-11-16T22:27:00, kp_index 0,
 *   estimated_kp 0.0 — quiet right now.
 * - Kp forecast JSON (`products/noaa-planetary-k-index-forecast.json`)
 *   → HTTP 200, 81 entries, 3-hourly; fields time_tag, kp, observed,
 *   noaa_scale (e.g. "G1", null below scale).
 * - 3-day forecast text → HTTP 200, issued 2026 Nov 16 1230 UTC:
 *   "The greatest observed 3 hr Kp over the past 24 hours was 1 (below
 *   NOAA Scale levels). The greatest expected 3 hr Kp for Nov 16–Nov 18
 *   2026 is 4.67 (NOAA Scale G1)." Rationale: isolated G1 likely Nov
 *   17–18 (CH HSS + possible 14 Nov CME arrival).
 * - ACE solar wind + mag 1 h JSON (`json/ace/swepam/ace_swepam_1h.json`,
 *   `json/ace/mag/ace_mag_1h.json`) → both HTTP 200. (The
 *   `products/solar-wind/plasma-2-hour.json` / `mag-2-hour.json` paths
 *   404 — do not use them.)
 * - Ovation aurora latest JSON → HTTP 200 (v1 shows Kp + forecast +
 *   solar wind only; the oval-boundary extraction is an open item).
 *
 * NOAA G-scale: G1 = Kp 5, G2 = Kp 6, G3 = Kp 7, G4 = Kp 8, G5 = Kp 9.
 */
import { AURORA_OVERHEAD_KP, AURORA_VISIBLE_KP } from './policy.js';

/** NOAA G-scale label for a Kp value, or null below G1. */
export function kpToGScale(kp) {
  if (!Number.isFinite(kp)) return null;
  if (kp >= 9) return 'G5';
  if (kp >= 8) return 'G4';
  if (kp >= 7) return 'G3';
  if (kp >= 6) return 'G2';
  if (kp >= 5) return 'G1';
  return null;
}

/** One-word activity level for a Kp value. */
export function kpActivityLabel(kp) {
  if (!Number.isFinite(kp)) return 'unknown';
  if (kp >= 9) return 'extreme storm';
  if (kp >= 8) return 'severe storm';
  if (kp >= 7) return 'strong storm';
  if (kp >= 6) return 'moderate storm';
  if (kp >= 5) return 'minor storm';
  if (kp >= 4) return 'unsettled';
  return 'quiet';
}

/**
 * The honest mid-latitude aurora line for a Kp value. Never promises
 * aurora in Cape May County below Kp 8.
 */
export function auroraOutlook(kp) {
  if (!Number.isFinite(kp)) return 'Aurora outlook unknown.';
  if (kp >= AURORA_OVERHEAD_KP)
    return 'Aurora possible over Cape May tonight — look north on a dark, clear night.';
  if (kp >= AURORA_VISIBLE_KP)
    return 'Aurora may reach the northern Mid-Atlantic tonight — not overhead here, but look north.';
  if (kp >= 5)
    return 'Minor storm — possible GPS/HF effects, but no aurora this far south.';
  return 'No aurora this far south.';
}

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

/** Last row of the Kp 1-min feed → { timeTag, kp, estimatedKp }. */
export function normalizeKpCurrent(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (!last || typeof last !== 'object') return null;
  const kp = numValue(last.estimated_kp ?? last.kp_index);
  if (kp == null) return null;
  return {
    timeTag: textValue(last.time_tag),
    kp,
    kpIndex: numValue(last.kp_index),
    gScale: kpToGScale(kp),
    activity: kpActivityLabel(kp),
  };
}

/**
 * Kp forecast entries → { maxKp, maxKpTime, maxScale, entries }. Only
 * predicted entries count toward the max (observed history is the past).
 */
export function normalizeKpForecast(rows) {
  if (!Array.isArray(rows)) return null;
  const entries = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const kp = numValue(row.kp);
    if (kp == null) continue;
    entries.push({
      timeTag: textValue(row.time_tag),
      kp,
      observed: row.observed === 'observed',
      noaaScale: textValue(row.noaa_scale),
    });
  }
  if (entries.length === 0) return null;
  const predicted = entries.filter((entry) => !entry.observed);
  const pool = predicted.length ? predicted : entries;
  let max = pool[0];
  for (const entry of pool) {
    if (entry.kp > max.kp) max = entry;
  }
  return {
    maxKp: max.kp,
    maxKpTime: max.timeTag,
    maxScale: max.noaaScale ?? kpToGScale(max.kp),
    entries,
  };
}

/** Last ACE solar-wind row → { timeTag, speed, density, temperature }. */
export function normalizeAceSwepam(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (!last || typeof last !== 'object') return null;
  const speed = numValue(last.speed);
  if (speed == null) return null;
  return {
    timeTag: textValue(last.time_tag),
    speed,
    density: numValue(last.density),
    temperature: numValue(last.temperature),
  };
}

/** Last ACE magnetometer row → { timeTag, bt, bzGsm }. */
export function normalizeAceMag(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (!last || typeof last !== 'object') return null;
  const bt = numValue(last.bt);
  if (bt == null) return null;
  return {
    timeTag: textValue(last.time_tag),
    bt,
    bzGsm: numValue(last.bz_gsm),
  };
}

/**
 * Parse the SWPC 3-day forecast text for its headline numbers. Tolerates
 * rewording: every field falls back to null and the card quotes the raw
 * text block instead.
 */
export function parseThreeDayForecast(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  // "The greatest expected 3 hr Kp for Nov 16-Nov 18 2026 is 4.67 (NOAA
  // Scale G1)." — the date range between "Kp" and the value carries digits,
  // so the match must run past it to the "is <value>" anchor.
  const expected =
    /greatest expected 3 hr Kp[\s\S]*?is\s*([\d.]+)\s*\(NOAA Scale\s*(G\d)\)/i.exec(
      text,
    );
  const observed =
    /greatest observed 3 hr Kp over the past 24 hours was\s*(\d+)/i.exec(text);
  const issued = /:Issued:\s*([^\n]+)/.exec(text);
  return {
    greatestExpectedKp: expected ? Number(expected[1]) : null,
    greatestExpectedScale: expected ? expected[2] : null,
    greatestObservedKp: observed ? Number(observed[1]) : null,
    issued: issued ? issued[1].trim() : null,
  };
}

/**
 * Validate a provider snapshot before it can replace the displayed card.
 * The Kp half is required; forecast / solar wind / mag may be null when
 * their product is down (the card shows what loaded).
 */
export function validateSpaceWeatherSnapshot(snapshot) {
  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    typeof snapshot.stale !== 'boolean' ||
    !snapshot.kp ||
    typeof snapshot.kp !== 'object' ||
    !Number.isFinite(snapshot.kp.kp)
  ) {
    throw new TypeError('Space weather source returned an invalid snapshot');
  }
  return snapshot;
}
