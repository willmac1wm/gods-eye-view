// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

export const EMERGENCY_COMPOSITE_LAYER_ID = 'emergency-composite';
export const EMERGENCY_COMPOSITE_OVERLAY_SOURCE_ID = 'emergency-composite';
export const EMERGENCY_COMPOSITE_ATTRIBUTION = msg(
  'National Weather Service · FEMA IPAWS · Fire Wire CAD · Fallout plume',
);
// NWS cadence: the composite reads the existing layers' states on every
// refresh. No new poller — NWS refreshes every 5 min, CAD live, IPAWS on
// its archive cycle, the plume when its scenario runs.
export const EMERGENCY_COMPOSITE_REFRESH_MS = 5 * 60 * 1000;
export const EMERGENCY_COMPOSITE_OVERLAY_COHORT_LIMIT = 2;
/** NWS zones the county sits in (informational — the NWS layer covers them). */
export const EMERGENCY_COMPOSITE_NWS_ZONES = Object.freeze([
  'NJZ023',
  'NJZ024',
  'NJZ026',
]);
/** The IPAWS archive is 24 h delayed BY DESIGN — a backfill layer, not a
 * real-time alerter. The delay is labeled on the quadrant, never hidden. */
export const EMERGENCY_COMPOSITE_IPAWS_DELAY_H = 24;
/** How many IPAWS items the quadrant lists. */
export const EMERGENCY_COMPOSITE_IPAWS_LIMIT = 10;
/** How far back a quadrant's last update may be before it reads stale. */
export const EMERGENCY_COMPOSITE_STALE_MS = 15 * 60 * 1000;
/** The sidecar route for the newest IPAWS-sourced alerts (slim rows). */
export const EMERGENCY_COMPOSITE_IPAWS_ROUTE = '/api/alerts/ipaws';
/**
 * Link-out registry — links, not data. No shelter or evacuation API exists
 * in v1 (Red Cross 403s bots on both egresses; PHMSA 404s), so the panel
 * links out and never claims to know whether shelters are open.
 * URLs verified live 2026-11-17 (Red Cross 403, NRC 301 → new path 200,
 * NJ OEM 200, disasterassistance.gov 200, Ready.gov 200).
 */
export const EMERGENCY_COMPOSITE_LINKS = Object.freeze([
  Object.freeze({
    id: 'red-cross-shelter',
    label: msg('Red Cross open shelter'),
    url: 'https://www.redcross.org/get-help/disaster-relief-and-recovery/find-an-open-shelter.html',
    note: msg('Red Cross decides what is open'),
  }),
  Object.freeze({
    id: 'nj-oem',
    label: msg('NJ Office of Emergency Management'),
    url: 'https://www.nj.gov/njoem/',
    note: msg('County and state emergency management'),
  }),
  Object.freeze({
    id: 'fema-assistance',
    label: msg('FEMA Disaster Assistance'),
    url: 'https://www.disasterassistance.gov/',
    note: msg('Recovery centers and assistance'),
  }),
  Object.freeze({
    id: 'nrc-events',
    label: msg('NRC event reports'),
    url: 'https://www.nrc.gov/documents-reports/document-collections/events-reports-associated-with/event-notification-reports',
    note: msg('Nuclear event notifications'),
  }),
  Object.freeze({
    id: 'ready-kit',
    label: msg('Ready.gov disaster kit'),
    url: 'https://www.ready.gov/kit',
    note: msg('Disaster supplies kit'),
  }),
  Object.freeze({
    id: 'ready-plan',
    label: msg('Ready.gov family plan'),
    url: 'https://www.ready.gov/plan',
    note: msg('Family emergency plan'),
  }),
]);
