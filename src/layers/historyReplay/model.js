import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  HISTORY_COUNTY_CENTER,
  HISTORY_OVERLAY_COHORT_LIMIT,
  HISTORY_OVERLAY_SOURCE_ID,
} from './policy.js';
import { feedAt, formatReplayTime, positionsAt } from './records.js';

export { HISTORY_OVERLAY_COHORT_LIMIT };

const KIND_ACCENT = Object.freeze({
  air: () => Cesium.Color.DEEPSKYBLUE,
  mil: () => Cesium.Color.ORANGE,
  emg: () => Cesium.Color.RED,
  ship: () => Cesium.Color.TEAL,
});

/**
 * Overlay entries at replay cursor T: one label per aircraft at its
 * latest stored position at or before T, plus feed items published in
 * the 15 minutes before T. Aircraft are capped at the cohort limit
 * (newest first). A pin is a stored position, never a live one — the
 * title always carries the stored time.
 */
export function createHistoryOverlayEntries({
  aircraftRows,
  feedRows,
  cursorMs,
} = {}) {
  const positions = positionsAt(aircraftRows, cursorMs).slice(
    -HISTORY_OVERLAY_COHORT_LIMIT,
  );
  const entries = positions.map((row) => {
    const accent = (KIND_ACCENT[row.kind] ?? KIND_ACCENT.air)();
    const seen = formatReplayTime(row.seenAt) ?? '';
    return {
      id: `history:${row.hex}:${row.seenAt}`,
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      variant: 'label',
      title: `✈ ${row.flight ?? row.hex}${seen ? ` · ${seen}` : ''}`,
      subtitle:
        row.alt != null || row.speed != null
          ? [
              row.alt != null ? `${Math.round(row.alt)} ft` : null,
              row.speed != null ? `${Math.round(row.speed)} kt` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : null,
      details: [
        ...(row.kind ? [row.kind] : []),
        ...(row.track != null
          ? [`${msg('Track')} ${Math.round(row.track)}°`]
          : []),
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
  for (const item of feedAt(feedRows, cursorMs)) {
    entries.push({
      id: `history-feed:${item.id}:${item.pubMs}`,
      position:
        item.lat != null && item.lng != null
          ? Cesium.Cartesian3.fromDegrees(item.lng, item.lat)
          : Cesium.Cartesian3.fromDegrees(
              HISTORY_COUNTY_CENTER.lon,
              HISTORY_COUNTY_CENTER.lat,
            ),
      variant: 'label',
      title: `📰 ${item.title}`,
      subtitle: item.sourceLabel ?? item.source ?? null,
      details: [
        ...(item.cat ? [item.cat] : []),
        ...(item.type ? [item.type] : []),
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
    });
  }
  return entries;
}

/**
 * County summary label: the replay cursor, how many aircraft/feed items
 * are shown at it, and the stored window. An empty window is a real
 * result — "no stored positions in this window" with the window shown —
 * never an empty map presented as "nothing was there".
 */
export function createHistorySummaryEntry({
  status,
  cursorMs,
  fromMs,
  untilMs,
  aircraftShown = 0,
  feedShown = 0,
} = {}) {
  const cursor = formatReplayTime(cursorMs);
  const from = formatReplayTime(fromMs);
  const until = formatReplayTime(untilMs);
  const windowText =
    from && until
      ? `${msg('Stored')} ${from}–${until}`
      : status?.oldestMs && status?.newestMs
        ? `${msg('Stored')} ${formatReplayTime(status.oldestMs)}–${formatReplayTime(status.newestMs)}`
        : msg('History unavailable');
  return {
    id: HISTORY_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      HISTORY_COUNTY_CENTER.lon,
      HISTORY_COUNTY_CENTER.lat,
    ),
    variant: 'label',
    title:
      cursor == null
        ? `🕘 ${msg('History replay')}`
        : aircraftShown === 0 && feedShown === 0
          ? `🕘 ${cursor} · ${msg('No stored positions in this window')}`
          : `🕘 ${cursor} · ${aircraftShown} ${msg('aircraft')} · ${feedShown} ${msg('feed')}`,
    details: [windowText],
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

/** Analyst seam. Pure — no Cesium types. One row per stored record. */
export function mapAnalystRecord(raw, index = 0) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  if (raw?.seenAt != null) {
    return {
      id: text(raw?.hex)
        ? `HISTORY-AIR-${raw.hex}-${raw.seenAt}`
        : `HISTORY-AIR-${String(index).padStart(4, '0')}`,
      title: text(raw?.flight) ?? text(raw?.hex),
      kind: text(raw?.kind),
      lat: num(raw?.lat),
      lon: num(raw?.lon),
      alt: num(raw?.alt),
      speed: num(raw?.speed),
      track: num(raw?.track),
      seenAt: num(raw?.seenAt),
      source: 'Cape Dispatch history (stored ADS-B)',
    };
  }
  return {
    id: text(raw?.id)
      ? `HISTORY-FEED-${raw.id}`
      : `HISTORY-FEED-${String(index).padStart(4, '0')}`,
    title: text(raw?.title),
    source: text(raw?.source),
    sourceLabel: text(raw?.sourceLabel),
    cat: text(raw?.cat),
    type: text(raw?.type),
    lat: num(raw?.lat),
    lng: num(raw?.lng),
    pubMs: num(raw?.pubMs),
    sourceOrigin: 'Cape Dispatch history (stored feed)',
  };
}
