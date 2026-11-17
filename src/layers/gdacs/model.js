// src/layers/gdacs/model.js
import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  GDACS_ALERT_ACCENT,
  GDACS_ALERT_EMOJI,
  GDACS_OVERLAY_COHORT_LIMIT,
  GDACS_OVERLAY_SOURCE_ID,
} from './policy.js';
import { sortGdacsEvents } from './records.js';

export { GDACS_OVERLAY_COHORT_LIMIT };

/**
 * One label per positioned GDACS event, Red first. The label carries
 * GDACS's own alert level and type — the level is GDACS's severity, not
 * ours. Unpositioned events have no pin (they still list in the panel);
 * wildfire-heavy days are capped at the cohort limit so the map stays
 * readable.
 */
export function createGdacsOverlayEntries({ events = [] }) {
  const positioned = sortGdacsEvents(events).filter(
    (event) => event.hasPosition,
  );
  return positioned.slice(0, GDACS_OVERLAY_COHORT_LIMIT).map((event) => ({
    id: `${GDACS_OVERLAY_SOURCE_ID}-${event.id}`,
    position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
    variant: 'label',
    title: `${GDACS_ALERT_EMOJI[event.alertLevel] ?? ''} ${event.typeLabel} · ${event.country ?? event.iso3 ?? '—'}`,
    subtitle: `${msg('GDACS')} ${event.alertLevel} · ${event.title.slice(0, 80)}`,
    accent: Cesium.Color.fromCssColorString(
      GDACS_ALERT_ACCENT[event.alertLevel] ?? '#7cff9b',
    ).toCssColorString(),
    priority: event.alertRank ?? 1,
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  }));
}

/** Analyst seam. Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.id) || `GDACS-${String(index).padStart(4, '0')}`,
    eventId: text(raw?.eventId),
    type: text(raw?.type),
    typeLabel: text(raw?.typeLabel),
    alertLevel: text(raw?.alertLevel),
    title: text(raw?.title),
    country: text(raw?.country),
    iso3: text(raw?.iso3),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    fromDate: text(raw?.fromDate),
    toDate: text(raw?.toDate),
    severity: text(raw?.severity?.text),
    population: text(raw?.population?.text),
    link: text(raw?.link),
  };
}
