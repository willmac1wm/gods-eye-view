// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

import { EMERGENCY_COMPOSITE_LAYER_ID } from './policy.js';

/** A quadrant's short status line for the summary label. */
function quadrantLine(label, quadrant, countText) {
  if (!quadrant?.available) return `${label}: ${msg('unavailable')}`;
  if (quadrant.stale) return `${label}: ${msg('stale')}`;
  return `${label}: ${countText}`;
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** The summary entry: one label per quadrant, on the card's info line. */
export function createEmergencyCompositeSummaryEntry(snapshot) {
  if (!snapshot) {
    return {
      id: EMERGENCY_COMPOSITE_LAYER_ID,
      label: msg('Emergency composite'),
      info: msg('No data yet'),
    };
  }
  const { alerts, incidents, hazmat, evacuation } = snapshot;
  const evacuationLine = evacuation?.guidance
    ? msg('Evacuation guidance published')
    : msg('No evacuation order in effect');
  const hazmatCount =
    (hazmat?.ipaws?.items?.length ?? 0) + (hazmat?.plume?.active ? 1 : 0);
  return {
    id: EMERGENCY_COMPOSITE_LAYER_ID,
    label: msg('Emergency composite'),
    info: [
      quadrantLine(
        msg('Alerts'),
        alerts,
        alerts?.active > 0
          ? `${alerts.active} ${msg('active')}`
          : msg('none active'),
      ),
      quadrantLine(
        msg('Incidents'),
        incidents,
        incidents?.quiet
          ? msg('quiet')
          : `${incidents.activeIncidents} ${msg('active')}`,
      ),
      quadrantLine(
        msg('Hazmat'),
        hazmat,
        hazmatCount > 0
          ? `${hazmatCount} ${msg('active')}`
          : msg('nothing reported'),
      ),
      evacuationLine,
    ].join(' · '),
  };
}

/** One analyst record per active NWS alert, plus one per IPAWS item. */
export function mapAnalystRecord(row) {
  return {
    id: row.id,
    lat: null,
    lon: null,
    event: row.event ?? null,
    severity: row.severity ?? null,
    time: row.timeMs ?? null,
    source: row.source ?? null,
  };
}

export function getAnalystRecords(snapshot) {
  if (!snapshot) return [];
  const records = [];
  for (const alert of snapshot.alerts?.topAlerts ?? []) {
    records.push(
      mapAnalystRecord({
        id: alert.id,
        event: alert.event,
        severity: alert.severity,
        timeMs: alert.timeMs,
        source: 'National Weather Service',
      }),
    );
  }
  for (const item of snapshot.hazmat?.ipaws?.items ?? []) {
    records.push(
      mapAnalystRecord({
        id: item.id,
        event: item.title,
        severity: item.severity,
        timeMs: item.seenAtMs,
        source: 'FEMA IPAWS',
      }),
    );
  }
  return records;
}

export { fmtTime };
