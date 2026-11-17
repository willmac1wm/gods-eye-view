import * as Cesium from 'cesium';
import { FAA_STATUS_LOCAL_AIRPORTS } from './records.js';
export const FAA_STATUS_OVERLAY_SOURCE_ID = 'faa-status';
export const FAA_STATUS_OVERLAY_COHORT_LIMIT = 3;
export const FAA_STATUS_ATTRIBUTION = 'Source: FAA NAS Status';

/** Ground stop / closure = major; ground delay = moderate; arrival/departure = minor. */
export const FAA_STATUS_SEVERITY_COLORS = Object.freeze({
  major: Cesium.Color.RED,
  moderate: Cesium.Color.ORANGE,
  minor: Cesium.Color.YELLOW,
});

export function eventSeverity(category) {
  if (category === 'ground-stop' || category === 'closure') return 'major';
  if (category === 'ground-delay') return 'moderate';
  return 'minor';
}

export function severityColor(category) {
  return FAA_STATUS_SEVERITY_COLORS[eventSeverity(category)];
}

const CATEGORY_LABELS = Object.freeze({
  'ground-stop': 'Ground Stop',
  'ground-delay': 'Ground Delay',
  closure: 'Airport Closure',
  'arrival-departure': 'Arrival/Departure Delay',
});

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? 'Delay';
}

/** One overlay label per local event: "ACY — Ground Stop". */
export function createFaaStatusOverlayEntry({ event }) {
  const airport = FAA_STATUS_LOCAL_AIRPORTS[event.airport] ?? null;
  const detail = [event.reason, event.avg, event.max]
    .filter(Boolean)
    .join(' · ');
  return {
    id: `${event.airport}:${event.category}`,
    position: Cesium.Cartesian3.fromDegrees(
      airport?.lon ?? 0,
      airport?.lat ?? 0,
    ),
    variant: 'label',
    title: `${event.airport} — ${categoryLabel(event.category)}`,
    subtitle: detail || null,
    accent: severityColor(event.category).toCssColorString(),
    priority: eventSeverity(event.category) === 'major' ? 5000 : 1000,
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

/** Analyst seam (mirror of mapAnalystRecord). Pure — no Cesium types. */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const airport = text(raw?.airport) ?? `FAA-${String(index).padStart(4, '0')}`;
  const coords = FAA_STATUS_LOCAL_AIRPORTS[airport] ?? {};
  return {
    id: `${airport}:${text(raw?.category) ?? 'unknown'}`,
    airport,
    category: text(raw?.category),
    reason: text(raw?.reason),
    start: text(raw?.start),
    reopen: text(raw?.reopen),
    endTime: text(raw?.endTime),
    avg: text(raw?.avg),
    max: text(raw?.max),
    trend: text(raw?.trend),
    delayType: text(raw?.delayType),
    startMs: num(raw?.startMs),
    reopenMs: num(raw?.reopenMs),
    lat: num(coords.lat),
    lon: num(coords.lon),
  };
}
