import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  AI_SITUATION_COUNTY_CENTER,
  AI_SITUATION_OVERLAY_SOURCE_ID,
  AI_SITUATION_UNOFFICIAL_BANNER,
} from './policy.js';
import { accuracyLabel, predictionStatusLabel } from './records.js';

/**
 * One county summary label for the AI situation. The title carries the
 * latest open prediction (or the accuracy record when there is none);
 * the details carry the accuracy counts and the writer state. With no
 * writer configured the panel says so — the forecaster's rules half
 * still computes, but no plain-English draft is written. Never a
 * prediction presented as official guidance.
 */
export function createAiSituationSummaryEntry({ snapshot } = {}) {
  const predictions = snapshot?.predictions ?? [];
  const latest = predictions[0] ?? null;
  const accent = latest
    ? latest.outcome === 'confirmed'
      ? Cesium.Color.fromCssColorString('#9fd6a4')
      : latest.outcome === 'wrong'
        ? Cesium.Color.fromCssColorString('#e08a8a')
        : Cesium.Color.fromCssColorString('#7aa5ff')
    : Cesium.Color.GRAY;
  const title = latest
    ? `🤖 ${latest.text.length > 120 ? `${latest.text.slice(0, 117)}…` : latest.text}`
    : `🤖 ${msg('AI situation — no predictions yet')}`;
  const details = [
    accuracyLabel(snapshot?.accuracy),
    snapshot?.writerEnabled
      ? msg('Writer enabled')
      : msg('Writer not configured — rules-only predictions'),
    ...(latest ? [predictionStatusLabel(latest)] : []),
  ];
  return {
    id: AI_SITUATION_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      AI_SITUATION_COUNTY_CENTER.lon,
      AI_SITUATION_COUNTY_CENTER.lat,
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

/** Analyst seam. Pure — no Cesium types. One row per prediction. */
export function mapAnalystRecord(prediction, index = 0) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: prediction?.id
      ? `AI-PREDICTION-${prediction.id}`
      : `AI-PREDICTION-${String(index).padStart(4, '0')}`,
    ruleId: text(prediction?.ruleId),
    text: text(prediction?.text),
    confidence: num(prediction?.confidence),
    outcome: text(prediction?.outcome),
    whatWouldChangeIt: text(prediction?.whatWouldChangeIt),
    sources: Array.isArray(prediction?.sourceRecordIds)
      ? prediction.sourceRecordIds
      : [],
    createdAt: num(prediction?.createdAt),
    validUntil: num(prediction?.validUntil),
    checkedAgainst: text(prediction?.checkedAgainst),
    source: 'Cape Dispatch AI forecaster',
  };
}

/** One analyst row per prediction in the snapshot. */
export function getAnalystRecords(snapshot) {
  return (snapshot?.predictions ?? []).map((prediction, index) =>
    mapAnalystRecord(prediction, index),
  );
}
