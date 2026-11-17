// src/layers/sanctionsWatch/records.js
// Pure record rules for the sanctions / dark-vessel watch: IMO validation,
// ArcNautical screening normalization, and the AIS-derived dark-vessel
// signals (silence is computed by the layer over absent vessels; the
// per-fix signals live here). No network, no Cesium, no clock.
import {
  COVERAGE_MIN_VESSELS,
  COVERAGE_WINDOW_MS,
  IMPLIED_SPEED_THRESHOLD_KN,
  REPORTED_SPEED_THRESHOLD_KN,
  SILENCE_THRESHOLD_MS,
  arcnauticalReportUrl,
} from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/** An IMO number is exactly 7 digits. Anything else is not an IMO. */
export function normalizeImo(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\s-]/g, '');
  return /^\d{7}$/.test(text) ? text : null;
}

/**
 * IMO check digit: the last digit of the sum of the first six digits
 * weighted 7..2. ArcNautical returns checkDigitValid — reject a bad IMO
 * client-side before calling, the same way.
 */
export function isValidImo(value) {
  const imo = normalizeImo(value);
  if (!imo) return false;
  const weights = [7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Number(imo[i]) * weights[i];
  return sum % 10 === Number(imo[6]);
}

function statusValue(value) {
  const text = textValue(value);
  return text ? text.toUpperCase() : null;
}

/**
 * Normalize one ArcNautical keyless check payload. Returns null for
 * anything that is not a recognizable screening (the caller treats that
 * as "screening unavailable", never as a clean verdict). A GREEN result
 * is "no matches found in the sources screened at <time>" — never
 * "this vessel is clean".
 */
export function validateScreening(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const imo = normalizeImo(payload.imo);
  if (!imo) return null;
  const sanctions =
    payload.sanctions && typeof payload.sanctions === 'object'
      ? payload.sanctions
      : {};
  const ownership =
    payload.ownership && typeof payload.ownership === 'object'
      ? payload.ownership
      : {};
  const vetting =
    payload.vetting && typeof payload.vetting === 'object'
      ? payload.vetting
      : {};
  const status = statusValue(sanctions.status);
  if (!status) return null;
  return {
    imo,
    vesselName: textValue(payload.vesselName),
    sanctionsStatus: status,
    sanctionsDetail: textValue(sanctions.detail),
    coverageComplete: sanctions.coverageComplete === true,
    coverageGaps: Array.isArray(sanctions.coverageGaps)
      ? sanctions.coverageGaps.map((gap) => String(gap)).filter(Boolean)
      : [],
    ownershipOpacity: textValue(ownership.opacity),
    ownershipScore: numValue(ownership.score),
    vettingGrade: textValue(vetting.grade),
    vettingScore: numValue(vetting.score),
    vettingStatus: textValue(vetting.status),
    checkedAt: textValue(payload.checkedAt),
    fullReport: textValue(payload.fullReport) ?? arcnauticalReportUrl(imo),
    tier: textValue(payload.tier),
  };
}

/** True when the screening found a match against a screened list. */
export function isSanctionsMatch(screening) {
  return Boolean(screening) && screening.sanctionsStatus !== 'GREEN';
}

export function buildScreeningLinks(imo) {
  const normalized = normalizeImo(imo);
  if (!normalized) return null;
  return { fullReport: arcnauticalReportUrl(normalized) };
}

/** Great-circle distance in kilometres between two lat/lon fixes. */
export function distanceKm(aLat, aLon, bLat, bLon) {
  const latA = numValue(aLat);
  const lonA = numValue(aLon);
  const latB = numValue(bLat);
  const lonB = numValue(bLon);
  if (latA === null || lonA === null || latB === null || lonB === null)
    return null;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(latB - latA);
  const dLon = rad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(latA)) * Math.cos(rad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Implied speed in knots between two fixes, or null when uncomputable. */
export function impliedSpeedKn(previous, current) {
  const km = distanceKm(
    previous?.lat,
    previous?.lon,
    current?.lat,
    current?.lon,
  );
  const prevMs = numValue(previous?.lastPositionEpoch);
  const currMs = numValue(current?.lastPositionEpoch);
  if (km === null || prevMs === null || currMs === null) return null;
  const hours = (currMs - prevMs) / 3_600_000;
  if (!(hours > 0)) return null;
  return km / 1.852 / hours;
}

/**
 * Per-fix dark-vessel signals for a vessel currently in the AIS feed.
 * `previous` is the layer's last-seen identity for the same MMSI (or
 * null on first sight). Silence is not computed here — it needs the
 * vessel to be ABSENT from the feed, which the layer sweeps separately.
 * Signals are observations, never accusations.
 */
export function detectSignals(record, previous) {
  const signals = [];
  const speed = numValue(record?.speedKts ?? record?.speed);
  if (speed !== null && speed > REPORTED_SPEED_THRESHOLD_KN) {
    signals.push({
      kind: 'impossible-speed',
      detail: `Reported ${speed} kn`,
    });
  }
  if (previous) {
    const implied = impliedSpeedKn(previous, record);
    if (implied !== null && implied > IMPLIED_SPEED_THRESHOLD_KN) {
      signals.push({
        kind: 'implied-speed',
        detail: `Implied ${Math.round(implied)} kn between fixes`,
      });
    }
    const prevName = textValue(previous.name);
    const nextName = textValue(record?.name);
    const prevImo = normalizeImo(previous.imo);
    const nextImo = normalizeImo(record?.imo);
    if (
      (prevName && nextName && prevName !== nextName) ||
      (prevImo && nextImo && prevImo !== nextImo)
    ) {
      signals.push({
        kind: 'identity-change',
        detail: prevName
          ? `Previously ${prevName}`
          : 'Identity differs from previous sighting',
      });
    }
  }
  return signals;
}

/**
 * Silence signal for a vessel last seen long ago while the receiver
 * coverage is alive. `coverageAlive` is true when at least
 * COVERAGE_MIN_VESSELS other vessels reported inside COVERAGE_WINDOW_MS
 * — that rules out a receiver outage. The copy says "last seen <time>,
 * <n> h ago" and never "gone dark" as a fact.
 */
export function detectSilence(seen, nowMs, coverageAlive) {
  if (!seen || !coverageAlive) return null;
  const lastMs = numValue(seen.lastPositionEpoch ?? seen.lastSeenMs);
  if (lastMs === null) return null;
  const silentMs = nowMs - lastMs;
  if (silentMs <= SILENCE_THRESHOLD_MS) return null;
  return {
    kind: 'silence',
    detail: `Last seen ${Math.floor(silentMs / 3_600_000)} h ago`,
    silentMs,
  };
}

/** Count distinct vessels reporting inside the coverage window. */
export function countReportingVessels(records, nowMs) {
  const seen = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const lastMs = numValue(record?.lastPositionEpoch);
    if (lastMs === null) continue;
    if (nowMs - lastMs > COVERAGE_WINDOW_MS) continue;
    const mmsi = textValue(record?.mmsi);
    if (mmsi) seen.add(mmsi);
  }
  return seen.size;
}

export function coverageIsAlive(records, nowMs) {
  return countReportingVessels(records, nowMs) >= COVERAGE_MIN_VESSELS;
}
