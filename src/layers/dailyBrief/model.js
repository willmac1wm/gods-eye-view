import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  DAILY_BRIEF_COUNTY_CENTER,
  DAILY_BRIEF_OVERLAY_SOURCE_ID,
} from './policy.js';
import { briefStatusLabel } from './records.js';

/**
 * One county summary label for the latest brief. The headline is the
 * title; the details carry the date, the confidence, and the status — a
 * brief in review shows as in review, a stale brief shows its date and
 * says so, and no brief at all says why (writer not configured vs not
 * written yet). Never a stale brief presented as today's.
 */
export function createDailyBriefSummaryEntry({ snapshot } = {}) {
  const brief = snapshot?.brief ?? null;
  const accent =
    brief?.status === 'review'
      ? Cesium.Color.ORANGE
      : brief
        ? Cesium.Color.fromCssColorString('#7aa5ff')
        : Cesium.Color.GRAY;
  const title = brief
    ? `📰 ${brief.headline}`
    : snapshot?.writerEnabled
      ? `📰 ${msg('No daily brief yet')}`
      : `📰 ${msg('Daily brief unavailable — writer not configured')}`;
  const details = brief
    ? [
        ...(brief.dateLabel ? [brief.dateLabel] : []),
        ...(brief.confidence !== null && brief.confidence !== undefined
          ? [`${msg('Confidence')}: ${Math.round(brief.confidence * 100)}%`]
          : []),
        briefStatusLabel(brief),
      ]
    : [
        snapshot?.writerEnabled
          ? msg('The first brief is written at 07:00 local')
          : msg('Set GEMINI_API_KEY on the sidecar to enable the writer'),
      ];
  return {
    id: DAILY_BRIEF_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      DAILY_BRIEF_COUNTY_CENTER.lon,
      DAILY_BRIEF_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title,
    details,
    accent: accent.toCssColorString(),
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

/** Analyst seam. Pure — no Cesium types. One row for the latest brief. */
export function mapAnalystRecord(snapshot, index = 0) {
  const brief = snapshot?.brief ?? null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: brief?.slug
      ? `DAILY-BRIEF-${brief.slug}`
      : `DAILY-BRIEF-${String(index).padStart(4, '0')}`,
    title: text(brief?.headline),
    slug: text(brief?.slug),
    date: text(brief?.date),
    status: text(brief?.status),
    confidence: num(brief?.confidence),
    stale: brief?.stale ?? null,
    updatedAt: num(brief?.updatedAt),
    writerEnabled: snapshot?.writerEnabled ?? null,
    source: 'Cape Dispatch daily brief',
  };
}
