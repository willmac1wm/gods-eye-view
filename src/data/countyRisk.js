// County risk score (D4) — RULES only, never a bare LLM number.
//
// Every component is computed from live layer states by the rules below.
// Thresholds are DRAFT: William sets the final numbers. The score is a
// weighted mean over the components that have data; a missing component
// is excluded and its weight renormalized, never silently counted as
// zero. All inputs missing → no score at all, never a default 0 shown
// as "all clear".

import { msg } from '../i18n/marker.js';

export const COUNTY_RISK_CENTER = { lat: 39.0798, lon: -74.7625 };
export const COUNTY_RISK_BBOX = {
  latMin: 38.9,
  latMax: 39.35,
  lonMin: -75.15,
  lonMax: -74.55,
};

// Component weights (must sum to 1).
export const COUNTY_RISK_WEIGHTS = {
  weather: 0.4,
  power: 0.2,
  hazards: 0.2,
  lightning: 0.1,
  space: 0.1,
};

// Bands, highest first. Edges are inclusive at the lower bound.
// Labels are wrapped in msg() so the i18n extractor picks them up.
export const COUNTY_RISK_BANDS = [
  { level: 5, label: msg('Severe'), min: 80 },
  { level: 4, label: msg('High'), min: 60 },
  { level: 3, label: msg('Elevated'), min: 40 },
  { level: 2, label: msg('Guarded'), min: 20 },
  { level: 1, label: msg('Low'), min: 0 },
];

// NWS minor flood stage at Cape May (station 8536110), feet above MLLW.
// The tides layer carries per-station NWS thresholds; this constant is
// the fallback when a station's thresholds are unavailable.
export const COUNTY_TIDE_MINOR_FT = 6.2;

// Freshness: an input older than its TTL marks the whole score stale,
// never silently fresh.
export const COUNTY_RISK_TTLS_MS = {
  weather: 10 * 60 * 1000,
  power: 15 * 60 * 1000,
  hazards: 60 * 60 * 1000,
  lightning: 10 * 60 * 1000,
  space: 60 * 60 * 1000,
};

export const COUNTY_RISK_COMPONENTS = Object.keys(COUNTY_RISK_WEIGHTS);

/** Band for a 0–100 score. Null for anything that is not a finite score. */
export function bandForScore(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  for (const band of COUNTY_RISK_BANDS) {
    if (score >= band.min) return { level: band.level, label: band.label };
  }
  return null;
}

const clamp100 = (v) => Math.max(0, Math.min(100, v));

function scoreWeather(input) {
  const rules = [];
  let value = 0;
  if (input.warnings > 0) {
    value = Math.max(value, 60);
    rules.push('NWS warning active');
  }
  if (input.watches > 0) {
    value = Math.max(value, 40);
    rules.push('NWS watch active');
  }
  if (input.advisories > 0) {
    value = Math.max(value, 20);
    rules.push('NWS advisory active');
  }
  const stage = input.tideStage;
  const tideFt = input.tideFt;
  if (stage === 'major') {
    value = Math.max(value, 100);
    rules.push('Tide at major flood stage');
  } else if (stage === 'moderate') {
    value = Math.max(value, 85);
    rules.push('Tide at moderate flood stage');
  } else if (
    stage === 'minor' ||
    (Number.isFinite(tideFt) && tideFt >= COUNTY_TIDE_MINOR_FT)
  ) {
    value = Math.max(value, 70);
    rules.push(`Tide ≥ ${COUNTY_TIDE_MINOR_FT} ft (minor flood)`);
  }
  return { value, rules };
}

function scorePower(input) {
  const rules = [];
  const out = input.customersOut;
  if (!Number.isFinite(out)) return { value: 0, rules };
  let value = 0;
  if (out <= 0) {
    value = 0;
  } else if (out < 100) {
    value = 20;
    rules.push('Outages under 100 customers');
  } else if (out < 1000) {
    value = 40;
    rules.push('Outages 100–999 customers');
  } else {
    value = 60;
    rules.push('Outages ≥ 1,000 customers');
    const prev = input.customersOut1hAgo;
    if (Number.isFinite(prev) && out > prev) {
      value = 80;
      rules.push('Outages ≥ 1,000 and rising');
    }
  }
  if (input.majorEvent) {
    value = Math.max(value, 80);
    rules.push('Major outage event');
  }
  return { value, rules };
}

function scoreHazards(input) {
  const rules = [];
  let value = 0;
  if (input.gdacsRed > 0) {
    value = Math.max(value, 90);
    rules.push('GDACS Red event near the county');
  }
  if (input.gdacsOrange > 0) {
    value = Math.max(value, 60);
    rules.push('GDACS Orange event near the county');
  }
  const quake = input.quakeMax;
  if (Number.isFinite(quake)) {
    if (quake >= 5.5) {
      value = Math.max(value, 90);
      rules.push(`M${quake.toFixed(1)} earthquake nearby`);
    } else if (quake >= 4.0) {
      value = Math.max(value, 70);
      rules.push(`M${quake.toFixed(1)} earthquake nearby`);
    }
  }
  if (input.fireCount > 0) {
    value = Math.max(value, 50);
    rules.push('Active fire in the county');
  }
  return { value, rules };
}

function scoreLightning(input) {
  const rules = [];
  const n = input.flashes30m;
  if (!Number.isFinite(n) || n <= 0) return { value: 0, rules };
  let value = 0;
  if (n >= 300) {
    value = 100;
    rules.push('≥ 10 lightning flashes/min sustained');
  } else if (n >= 100) {
    value = 90;
    rules.push('100+ lightning flashes in 30 min');
  } else if (n >= 10) {
    value = 70;
    rules.push('10+ lightning flashes in 30 min');
  } else {
    value = 40;
    rules.push('Lightning in the county in the last 30 min');
  }
  return { value, rules };
}

function scoreSpace(input) {
  const rules = [];
  const kp = input.kp;
  if (Number.isFinite(kp)) {
    if (kp >= 8) {
      return { value: 100, rules: [`Kp ${kp} (G4+)`] };
    }
    if (kp >= 7) return { value: 80, rules: [`Kp ${kp} (G3)`] };
    if (kp >= 6) return { value: 60, rules: [`Kp ${kp} (G2)`] };
    if (kp >= 5) return { value: 40, rules: [`Kp ${kp} (G1)`] };
    return { value: 0, rules };
  }
  // No Kp reading: fall back to the G-scale label.
  const g = String(input.gScale ?? '')
    .trim()
    .toUpperCase();
  if (g === 'G5' || g === 'G4') return { value: 100, rules: [`${g} storm`] };
  if (g === 'G3') return { value: 80, rules: ['G3 storm'] };
  if (g === 'G2') return { value: 60, rules: ['G2 storm'] };
  if (g === 'G1') return { value: 40, rules: ['G1 storm'] };
  return { value: 0, rules };
}

const COMPONENT_SCORERS = {
  weather: scoreWeather,
  power: scorePower,
  hazards: scoreHazards,
  lightning: scoreLightning,
  space: scoreSpace,
};

/**
 * Score the county from normalized layer inputs.
 *
 * @param {object} inputs - { nowMs, weather, power, hazards, lightning,
 *   space } where each component is { available, updatedAtMs, ...fields }.
 * @returns {{score: number|null, band: {level,label}|null,
 *   components: object, missingInputs: string[], stale: boolean,
 *   computedAtMs: number}}
 */
export function scoreCountyRisk(inputs) {
  const nowMs = Number.isFinite(inputs?.nowMs) ? inputs.nowMs : Date.now();
  const components = {};
  const missingInputs = [];
  let stale = false;
  let weighted = 0;
  let weightSum = 0;
  for (const name of COUNTY_RISK_COMPONENTS) {
    const input = inputs?.[name];
    if (!input?.available) {
      missingInputs.push(name);
      components[name] = {
        available: false,
        value: null,
        rules: [],
        stale: false,
        updatedAtMs: null,
      };
      continue;
    }
    const { value, rules } = COMPONENT_SCORERS[name](input);
    const updatedAtMs = Number.isFinite(input.updatedAtMs)
      ? input.updatedAtMs
      : null;
    const isStale =
      updatedAtMs !== null && nowMs - updatedAtMs > COUNTY_RISK_TTLS_MS[name];
    if (isStale) stale = true;
    components[name] = {
      available: true,
      value: clamp100(value),
      rules,
      stale: isStale,
      updatedAtMs,
    };
    const weight = COUNTY_RISK_WEIGHTS[name];
    weighted += weight * components[name].value;
    weightSum += weight;
  }
  if (weightSum === 0) {
    return {
      score: null,
      band: null,
      components,
      missingInputs,
      stale,
      computedAtMs: nowMs,
    };
  }
  const score = Math.round(weighted / weightSum);
  return {
    score,
    band: bandForScore(score),
    components,
    missingInputs,
    stale,
    computedAtMs: nowMs,
  };
}
