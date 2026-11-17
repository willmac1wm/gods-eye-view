import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import { COUNTY_RISK_CENTER } from '../../data/countyRisk.js';
import {
  COUNTY_RISK_BAND_COLORS,
  COUNTY_RISK_COMPONENT_LABELS,
  COUNTY_RISK_OVERLAY_COHORT_LIMIT,
  COUNTY_RISK_OVERLAY_SOURCE_ID,
} from './policy.js';
import { formatComponentLine } from './records.js';

export { COUNTY_RISK_OVERLAY_COHORT_LIMIT };

function bandColor(label) {
  const hex = COUNTY_RISK_BAND_COLORS[label] ?? '#9e9e9e';
  return Cesium.Color.fromCssColorString(hex);
}

function valueColor(value) {
  if (value >= 80) return Cesium.Color.RED;
  if (value >= 60) return Cesium.Color.ORANGE;
  if (value >= 40) return Cesium.Color.YELLOW;
  return Cesium.Color.LIMEGREEN;
}

/**
 * County summary label: the score, the band, and what is missing or
 * stale. When no input has data the label says the score is unavailable
 * — a missing score is never drawn as a low score.
 */
export function createCountyRiskSummaryEntry({ snapshot } = {}) {
  const score = snapshot?.score;
  const band = snapshot?.band;
  const title =
    score === null || score === undefined || band === null
      ? `🛡️ ${msg('County risk unavailable')}`
      : `🛡️ ${msg('County risk')}: ${band.label} ${score}/100`;
  const details = [];
  if (snapshot?.stale) details.push(msg('Some inputs are stale'));
  if (snapshot?.missingInputs?.length > 0) {
    details.push(
      `${msg('Missing')}: ${snapshot.missingInputs
        .map((name) => COUNTY_RISK_COMPONENT_LABELS[name] ?? name)
        .join(', ')}`,
    );
  }
  const topRules = [];
  for (const [key, component] of Object.entries(snapshot?.components ?? {})) {
    if (component?.available && component.value >= 60) {
      topRules.push(...(component.rules ?? []).slice(0, 1));
    }
  }
  details.push(...topRules.slice(0, 2));
  return {
    id: 'county-risk:summary',
    position: Cesium.Cartesian3.fromDegrees(
      COUNTY_RISK_CENTER.lon,
      COUNTY_RISK_CENTER.lat,
    ),
    variant: 'label',
    title,
    subtitle: msg('Rules-based score from live layer states'),
    details,
    accent: band ? bandColor(band.label).toCssColorString() : '#9e9e9e',
    priority: 1,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** One label per available component, at the same county anchor. */
export function createCountyRiskOverlayEntries({ snapshot } = {}) {
  const entries = [];
  for (const [key, component] of Object.entries(snapshot?.components ?? {})) {
    if (!component?.available) continue;
    const label = COUNTY_RISK_COMPONENT_LABELS[key] ?? key;
    entries.push({
      id: `county-risk:${key}`,
      position: Cesium.Cartesian3.fromDegrees(
        COUNTY_RISK_CENTER.lon,
        COUNTY_RISK_CENTER.lat,
      ),
      variant: 'label',
      title: formatComponentLine(label, component),
      subtitle: null,
      details: (component.rules ?? []).slice(0, 2),
      accent: valueColor(component.value ?? 0).toCssColorString(),
      priority: 2,
      collisionGroup: 'ambient-label',
      paintLane: 'ambient-label',
      interactive: false,
      edgeFade: 'keyhole',
      horizonCull: true,
      terrainOcclusion: false,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    });
  }
  return entries.slice(0, COUNTY_RISK_OVERLAY_COHORT_LIMIT - 1);
}

/** Analyst seam: one record per score, for the query engine. */
export function mapAnalystRecord(snapshot, index = 0) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const components = {};
  for (const [key, component] of Object.entries(snapshot.components ?? {})) {
    components[key] = component?.available ? component.value : null;
  }
  return {
    id: `COUNTY-RISK-${String(index).padStart(4, '0')}`,
    score: snapshot.score ?? null,
    band: snapshot.band?.label ?? null,
    bandLevel: snapshot.band?.level ?? null,
    components,
    missingInputs: [...(snapshot.missingInputs ?? [])],
    stale: snapshot.stale === true,
    timeMs: snapshot.computedAtMs ?? null,
  };
}
