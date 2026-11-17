// Normalize + validate a county risk snapshot (D4).
//
// The snapshot is the scoreCountyRisk() result plus the raw inputs the
// panel shows (top NWS events, tide level, gauge readings, per-input
// availability). The scorer is the single source of truth for the
// numbers; this module only shapes what the layer displays.
import { COUNTY_RISK_COMPONENTS } from '../../data/countyRisk.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept
// local because AI tool services import this module outside the browser.
const msg = (text) => text;

const COMPONENT_KEYS = COUNTY_RISK_COMPONENTS;

function isFiniteNumber(v) {
  return Number.isFinite(v);
}

/** Normalize one snapshot payload into the layer's shape. Null if malformed. */
export function normalizeCountyRiskSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const components = payload?.components;
  if (!components || typeof components !== 'object') return null;
  for (const key of COMPONENT_KEYS) {
    const component = components[key];
    if (!component || typeof component !== 'object') return null;
    if (typeof component.available !== 'boolean') return null;
    if (
      component.value !== null &&
      (!isFiniteNumber(component.value) ||
        component.value < 0 ||
        component.value > 100)
    )
      return null;
  }
  const score = payload?.score;
  if (score !== null && (!isFiniteNumber(score) || score < 0 || score > 100))
    return null;
  const band = payload?.band;
  if (
    band !== null &&
    (typeof band !== 'object' ||
      !Number.isFinite(band?.level) ||
      typeof band?.label !== 'string')
  )
    return null;
  const inputs =
    payload?.inputs && typeof payload.inputs === 'object'
      ? payload.inputs
      : null;
  return {
    score: score ?? null,
    band: band ?? null,
    components: Object.fromEntries(
      COMPONENT_KEYS.map((key) => [
        key,
        {
          available: components[key].available,
          value: components[key].value,
          rules: Array.isArray(components[key].rules)
            ? components[key].rules.map((r) => String(r)).filter(Boolean)
            : [],
          stale: components[key].stale === true,
          updatedAtMs: isFiniteNumber(components[key].updatedAtMs)
            ? components[key].updatedAtMs
            : null,
        },
      ]),
    ),
    missingInputs: Array.isArray(payload?.missingInputs)
      ? payload.missingInputs.map((m) => String(m)).filter(Boolean)
      : [],
    stale: payload?.stale === true,
    computedAtMs: isFiniteNumber(payload?.computedAtMs)
      ? payload.computedAtMs
      : null,
    inputs,
  };
}

/** A snapshot is usable when it normalized and has at least one component. */
export function validateCountyRiskSnapshot(snapshot) {
  if (!snapshot) return null;
  return snapshot;
}

/** One display line for a component: "Weather 70 — NWS warning active". */
export function formatComponentLine(name, component) {
  if (!component?.available) return `${name}: ${msg('no data')}`;
  const rules = (component.rules ?? []).slice(0, 2).join('; ');
  return rules
    ? `${name} ${component.value} — ${rules}`
    : `${name} ${component.value}`;
}
