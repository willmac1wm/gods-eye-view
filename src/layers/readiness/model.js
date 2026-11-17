import * as Cesium from 'cesium';
import { msg } from '../../i18n/marker.js';
import {
  READINESS_COUNTY_CENTER,
  READINESS_DRIVER_LABELS,
  READINESS_OVERLAY_SOURCE_ID,
} from './policy.js';
import {
  activeDrivers,
  goBagSummary,
  readinessStatusLabel,
} from './records.js';

/**
 * One county summary label for readiness. The title carries the due-now
 * count; the details carry the go-bag line and the active drivers with
 * their live reasons. When nothing is due the label says "baseline kit"
 * (a quiet week is a real steady state); when a driver layer is missing
 * the label says live status is unavailable rather than "all clear".
 */
export function createReadinessSummaryEntry({ snapshot, householdSize } = {}) {
  const drivers = snapshot?.drivers ?? {};
  const dueCount = snapshot?.dueCount ?? 0;
  const unavailable = snapshot?.unavailable ?? [];
  const active = activeDrivers(drivers);
  const accent =
    dueCount > 0
      ? Cesium.Color.ORANGE
      : Cesium.Color.fromCssColorString('#7aa5ff');
  const title = `🛠️ ${msg('Readiness')}: ${readinessStatusLabel({ dueCount, unavailable })}`;
  const details = [
    goBagSummary(householdSize),
    ...(active.length > 0
      ? active.map(
          (name) =>
            `${READINESS_DRIVER_LABELS[name] ?? name}: ${drivers[name].reason ?? ''}`,
        )
      : [msg('No live driver active — baseline kit')]),
    ...(unavailable.length > 0
      ? [`${msg('Live status unavailable')}: ${unavailable.join(', ')}`]
      : []),
  ];
  return {
    id: READINESS_OVERLAY_SOURCE_ID,
    position: Cesium.Cartesian3.fromDegrees(
      READINESS_COUNTY_CENTER.lon,
      READINESS_COUNTY_CENTER.lat,
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

/** Analyst seam. Pure — no Cesium types. One row per checklist item. */
export function mapAnalystRecord(row, index = 0) {
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(row?.id) ?? `READINESS-${String(index).padStart(4, '0')}`,
    checklist: text(row?.checklistId),
    checklistTitle: text(row?.checklistTitle),
    text: text(row?.text),
    drivers: Array.isArray(row?.drivers) ? row.drivers : [],
    due: row?.due === true,
    dueReasons: Array.isArray(row?.dueReasons) ? row.dueReasons : [],
    done: row?.done === true,
    source: 'Cape Dispatch readiness — Ready.gov / FEMA',
  };
}
