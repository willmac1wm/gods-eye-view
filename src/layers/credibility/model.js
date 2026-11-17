import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  CREDIBILITY_COUNTY_CENTER,
  CREDIBILITY_OVERLAY_COHORT_LIMIT,
  CREDIBILITY_OVERLAY_SOURCE_ID,
} from './policy.js';
import { formatBreakdownLine } from './records.js';

export { CREDIBILITY_OVERLAY_COHORT_LIMIT };

/**
 * One overlay entry per scored cluster (top 5 by credibility, most
 * escalated first), plus a county summary label. The title carries the
 * score, the band, and the trend; `details` carries the top breakdown
 * lines — a score with no working is a black box and never ships as one.
 * Blocked-source exclusions are reported on the summary label, never
 * silently dropped.
 */
export function createCredibilityOverlayEntries({ snapshot } = {}) {
  const clusters = [...(snapshot?.clusters ?? [])]
    .sort((a, b) => {
      const trendRank = (t) =>
        t === 'Escalating' ? 0 : t === 'Elevated' ? 1 : 2;
      return (
        trendRank(a.trend) - trendRank(b.trend) ||
        (b.credibility ?? 0) - (a.credibility ?? 0)
      );
    })
    .slice(0, CREDIBILITY_OVERLAY_COHORT_LIMIT);
  const entries = clusters.map((cluster) => {
    const breakdownLines = (cluster.breakdown ?? [])
      .map(formatBreakdownLine)
      .filter(Boolean)
      .slice(0, 3);
    const accent =
      cluster.band === 'High'
        ? Cesium.Color.LIMEGREEN
        : cluster.band === 'Medium'
          ? Cesium.Color.ORANGE
          : Cesium.Color.RED;
    return {
      id: `credibility:${cluster.incidentKey}`,
      position: Cesium.Cartesian3.fromDegrees(
        CREDIBILITY_COUNTY_CENTER.lon,
        CREDIBILITY_COUNTY_CENTER.lat,
      ),
      variant: 'label',
      title: `⭐ ${cluster.credibility} · ${cluster.band ?? ''} · ${cluster.trend ?? 'Stabilizing'}`,
      subtitle: cluster.title ?? msg('Scored alert'),
      details: [
        ...(cluster.tierLabel
          ? [`${msg('Source tier')}: ${cluster.tierLabel}`]
          : []),
        ...(cluster.sourceCount !== null && cluster.sourceCount !== undefined
          ? [
              `${cluster.sourceCount} ${msg('source')}${cluster.sourceCount === 1 ? '' : 's'}`,
            ]
          : []),
        ...breakdownLines,
      ],
      accent: accent.toCssColorString(),
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
  });
  return entries;
}

/** County summary label: how many clusters are scored, and exclusions. */
export function createCredibilitySummaryEntry({ snapshot } = {}) {
  const count = snapshot?.clusters?.length ?? 0;
  const excluded = snapshot?.excludedCount ?? 0;
  return {
    id: CREDIBILITY_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      CREDIBILITY_COUNTY_CENTER.lon,
      CREDIBILITY_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title:
      count === 0
        ? `⭐ ${msg('No scored alerts')}`
        : `⭐ ${count} ${msg('scored alert')}${count === 1 ? '' : 's'}`,
    details: [
      msg('Credibility 0–100 · rules over stored alerts'),
      ...(excluded > 0
        ? [`${excluded} ${msg('blocked-source cluster(s) excluded')}`]
        : []),
    ],
    accent: Cesium.Color.fromCssColorString('#7aa5ff').toCssColorString(),
    priority: 0,
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

/** Analyst seam. Pure — no Cesium types. One row per scored cluster. */
export function mapAnalystRecord(raw, index = 0) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: text(raw?.incidentKey)
      ? `CREDIBILITY-${raw.incidentKey}`
      : `CREDIBILITY-${String(index).padStart(4, '0')}`,
    title: text(raw?.title),
    credibility: num(raw?.credibility),
    band: text(raw?.band),
    tier: num(raw?.tier),
    tierLabel: text(raw?.tierLabel),
    trend: text(raw?.trend),
    sourceCount: num(raw?.sourceCount),
    sources: Array.isArray(raw?.sources) ? raw.sources : [],
    lastSeen: num(raw?.lastSeen),
    source: 'Cape Dispatch credibility scoring',
  };
}
