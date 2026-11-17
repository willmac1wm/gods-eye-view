/**
 * Pure emergency-composite assembler. Given the already-read layer states
 * (NWS analyst records + stats, CAD stats, plume stats, IPAWS items from
 * the sidecar), build the four quadrants: Alerts / Incidents / Hazmat /
 * Shelter+Evacuation. A quadrant whose source is down, disabled, or never
 * refreshed is unavailable with its stale date — never an empty quadrant
 * presented as "all clear", and never a zero presented as "no cameras" /
 * "no incidents" when the data simply is not there.
 *
 * Evacuation guidance comes ONLY from official sources, quoted: the NWS
 * alert instruction text, when it mentions evacuation. Nothing else in
 * this module writes an evacuation instruction — no model output, no
 * inference. No such instruction published → guidance is null and the
 * panel says "no evacuation order in effect" (a real steady state).
 */
import { classifyNwsAlert } from '../countyRisk/inputs.js';
import {
  EMERGENCY_COMPOSITE_IPAWS_DELAY_H,
  EMERGENCY_COMPOSITE_STALE_MS,
} from './policy.js';

const num = (v) => (Number.isFinite(v) ? v : null);

/** True when the quadrant's last update is too old to trust. */
export function isStale(updatedAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(updatedAtMs)) return true;
  return nowMs - updatedAtMs > EMERGENCY_COMPOSITE_STALE_MS;
}

/**
 * Find the evacuation guidance in the NWS records: the first alert whose
 * official instruction text mentions evacuation. Returns the quoted text
 * with its event + source + link, or null when no alert carries one.
 * The alert id is the NWS API URL for the alert when it looks like one.
 */
export function findEvacuationGuidance(nwsRecords) {
  for (const record of nwsRecords || []) {
    const instruction = String(record?.instruction ?? '').trim();
    if (!instruction || !/evacuat/i.test(instruction)) continue;
    const id = String(record?.id ?? '').trim();
    return {
      text: instruction,
      event: String(record?.event ?? '').trim() || null,
      source: 'National Weather Service',
      url: id.startsWith('http') ? id : null,
    };
  }
  return null;
}

/** The Alerts quadrant from the NWS layer's analyst records + stats. */
export function assembleAlertsQuadrant(
  nwsRecords,
  nwsStats,
  nowMs = Date.now(),
) {
  const records = Array.isArray(nwsRecords) ? nwsRecords : [];
  let warnings = 0;
  let watches = 0;
  let advisories = 0;
  const topEvents = [];
  for (const record of records) {
    const kind = classifyNwsAlert(record);
    if (kind === 'warning') warnings += 1;
    else if (kind === 'watch') watches += 1;
    else if (kind === 'advisory') advisories += 1;
    const event = String(record?.event ?? '').trim();
    if (event && topEvents.length < 3 && !topEvents.includes(event)) {
      topEvents.push(event);
    }
  }
  const updatedAtMs = num(nwsStats?.lastUpdate);
  const available = updatedAtMs !== null || records.length > 0;
  return {
    available,
    updatedAtMs,
    stale: available ? isStale(updatedAtMs, nowMs) : false,
    active: records.length,
    warnings,
    watches,
    advisories,
    topEvents,
    // The first three alerts, slimmed, for the analyst records (model.js).
    topAlerts: records.slice(0, 3).map((record) => ({
      id: String(record?.id ?? ''),
      event: String(record?.event ?? '').trim(),
      severity: String(record?.severity ?? '').trim() || null,
      timeMs: num(record?.timeMs),
    })),
  };
}

/** The Incidents quadrant from the CAD layer's stats (count only). */
export function assembleIncidentsQuadrant(cadStats, nowMs = Date.now()) {
  const updatedAtMs = num(cadStats?.lastUpdate);
  const count = num(cadStats?.count);
  const available = updatedAtMs !== null;
  return {
    available,
    updatedAtMs,
    stale: available ? isStale(updatedAtMs, nowMs) : false,
    activeIncidents: count ?? 0,
    // Empty CAD while Fire Wire is quiet is healthy, not a blank chip —
    // but only when the feed has actually reported (available).
    quiet: available && count === 0,
    error: typeof cadStats?.error === 'string' ? cadStats.error : null,
  };
}

/** The Hazmat quadrant: IPAWS archive items + the plume scenario state. */
export function assembleHazmatQuadrant(
  { ipawsItems, ipawsAvailable, plumeStats },
  nowMs = Date.now(),
) {
  const items = (ipawsItems || []).map((item) => ({
    id: String(item?.incident_key ?? item?.id ?? ''),
    title: String(item?.title ?? '').trim(),
    severity: String(item?.severity ?? '').trim() || null,
    seenAtMs: num(item?.last_seen) !== null ? num(item.last_seen) * 1000 : null,
  }));
  const plumeUpdatedAtMs = num(plumeStats?.lastUpdate);
  const plumeAvailable = plumeUpdatedAtMs !== null;
  const plumeNodes = num(plumeStats?.count) ?? 0;
  const available = ipawsAvailable || plumeAvailable;
  return {
    available,
    updatedAtMs: plumeUpdatedAtMs,
    stale: plumeAvailable ? isStale(plumeUpdatedAtMs, nowMs) : false,
    ipaws: {
      available: ipawsAvailable,
      delayedByH: EMERGENCY_COMPOSITE_IPAWS_DELAY_H,
      items,
      newestAtMs: items.length > 0 ? items[0].seenAtMs : null,
    },
    plume: {
      available: plumeAvailable,
      // A scenario is running when the plume layer has computed path nodes.
      active: plumeAvailable && plumeNodes > 0,
      nodes: plumeNodes,
      updatedAtMs: plumeUpdatedAtMs,
      stale: Boolean(plumeStats?.stale),
    },
  };
}

/** Assemble the whole composite snapshot from the gathered inputs. */
export function assembleComposite(
  { nwsRecords, nwsStats, cadStats, plumeStats, ipawsItems, ipawsAvailable },
  nowMs = Date.now(),
) {
  const alerts = assembleAlertsQuadrant(nwsRecords, nwsStats, nowMs);
  const incidents = assembleIncidentsQuadrant(cadStats, nowMs);
  const hazmat = assembleHazmatQuadrant(
    { ipawsItems, ipawsAvailable, plumeStats },
    nowMs,
  );
  return {
    alerts,
    incidents,
    hazmat,
    evacuation: {
      guidance: alerts.available ? findEvacuationGuidance(nwsRecords) : null,
    },
    fetchedAt: nowMs,
  };
}

/** Shape check for a snapshot the source produced. */
export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object')
    return ['snapshot is not an object'];
  const errors = [];
  for (const key of ['alerts', 'incidents', 'hazmat', 'evacuation']) {
    if (!snapshot[key] || typeof snapshot[key] !== 'object')
      errors.push(`${key} is not an object`);
  }
  if (typeof snapshot.fetchedAt !== 'number')
    errors.push('fetchedAt is not a number');
  if (snapshot.alerts && typeof snapshot.alerts.active !== 'number')
    errors.push('alerts.active is not a number');
  if (
    snapshot.incidents &&
    typeof snapshot.incidents.activeIncidents !== 'number'
  )
    errors.push('incidents.activeIncidents is not a number');
  return errors;
}
