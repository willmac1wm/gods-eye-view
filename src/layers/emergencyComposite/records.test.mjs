import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleComposite,
  assembleAlertsQuadrant,
  assembleHazmatQuadrant,
  assembleIncidentsQuadrant,
  findEvacuationGuidance,
  validateSnapshot,
} from './records.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');

// The 6 live NWS alerts of 2026-11-13–14 (Freeze Warnings + Coastal Flood
// Advisories) — the spec's pinned quadrant case.
const SIX_ALERTS = [
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
    event: 'Freeze Warning',
    severity: 'Severe',
    instruction: 'Take steps now to protect tender plants from the cold.',
    timeMs: NOW - 3600_000,
  },
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-2',
    event: 'Freeze Warning',
    severity: 'Severe',
    instruction: null,
    timeMs: NOW - 3600_000,
  },
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-3',
    event: 'Coastal Flood Advisory',
    severity: 'Minor',
    instruction: null,
    timeMs: NOW - 3600_000,
  },
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-4',
    event: 'Coastal Flood Advisory',
    severity: 'Minor',
    instruction: null,
    timeMs: NOW - 3600_000,
  },
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-5',
    event: 'Freeze Warning',
    severity: 'Severe',
    instruction: null,
    timeMs: NOW - 3600_000,
  },
  {
    id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-6',
    event: 'Coastal Flood Advisory',
    severity: 'Minor',
    instruction: null,
    timeMs: NOW - 3600_000,
  },
];

const NWS_STATS = { lastUpdate: NOW - 60_000, count: 6 };
const CAD_STATS = { lastUpdate: NOW - 60_000, count: 3 };
const PLUME_STATS = { lastUpdate: NOW - 60_000, count: 4, stale: false };
const IPAWS_ITEMS = [
  {
    incident_key: 'ipaws-1',
    title: 'Tornado Warning',
    severity: 'critical',
    last_seen: Math.floor(NOW / 1000) - 86_400,
  },
];

test('six live NWS alerts assemble to six active with the right counts', () => {
  const quadrant = assembleAlertsQuadrant(SIX_ALERTS, NWS_STATS, NOW);
  assert.equal(quadrant.available, true);
  assert.equal(quadrant.stale, false);
  assert.equal(quadrant.active, 6);
  assert.equal(quadrant.warnings, 3);
  assert.equal(quadrant.watches, 0);
  assert.equal(quadrant.advisories, 3);
  assert.deepEqual(quadrant.topEvents, ['Freeze Warning', 'Coastal Flood Advisory']);
  assert.equal(quadrant.topAlerts.length, 3);
  assert.equal(quadrant.topAlerts[0].event, 'Freeze Warning');
});

test('a quadrant down is unavailable, never an empty all-clear', () => {
  const quadrant = assembleAlertsQuadrant([], null, NOW);
  assert.equal(quadrant.available, false);
  assert.equal(quadrant.active, 0);
  const incidents = assembleIncidentsQuadrant(null, NOW);
  assert.equal(incidents.available, false);
  assert.equal(incidents.quiet, false);
  const hazmat = assembleHazmatQuadrant(
    { ipawsItems: [], ipawsAvailable: false, plumeStats: null },
    NOW,
  );
  assert.equal(hazmat.available, false);
  assert.equal(hazmat.plume.active, false);
});

test('a stale last update flags the quadrant stale', () => {
  const quadrant = assembleAlertsQuadrant(SIX_ALERTS, { lastUpdate: NOW - 16 * 60_000 }, NOW);
  assert.equal(quadrant.available, true);
  assert.equal(quadrant.stale, true);
});

test('a quiet CAD feed is healthy, not a blank chip', () => {
  const incidents = assembleIncidentsQuadrant(
    { lastUpdate: NOW - 60_000, count: 0 },
    NOW,
  );
  assert.equal(incidents.available, true);
  assert.equal(incidents.activeIncidents, 0);
  assert.equal(incidents.quiet, true);
});

test('no evacuation instruction means no guidance — a steady state', () => {
  assert.equal(findEvacuationGuidance(SIX_ALERTS), null);
  const snapshot = assembleComposite(
    {
      nwsRecords: SIX_ALERTS,
      nwsStats: NWS_STATS,
      cadStats: CAD_STATS,
      plumeStats: PLUME_STATS,
      ipawsItems: IPAWS_ITEMS,
      ipawsAvailable: true,
    },
    NOW,
  );
  assert.equal(snapshot.evacuation.guidance, null);
  assert.deepEqual(validateSnapshot(snapshot), []);
});

test('evacuation guidance comes only from the official instruction text', () => {
  const guidance = findEvacuationGuidance([
    {
      id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-9',
      event: 'Hurricane Warning',
      severity: 'Extreme',
      instruction:
        'Evacuate the barrier islands before the storm surge arrives.',
    },
    { id: 'x', event: 'Freeze Warning', instruction: null },
  ]);
  assert.equal(guidance.text, 'Evacuate the barrier islands before the storm surge arrives.');
  assert.equal(guidance.event, 'Hurricane Warning');
  assert.equal(guidance.source, 'National Weather Service');
  assert.equal(guidance.url, 'https://api.weather.gov/alerts/NWS-IDP-PROD-9');
});

test('the IPAWS delay is labeled 24 h and items keep their seen time', () => {
  const hazmat = assembleHazmatQuadrant(
    { ipawsItems: IPAWS_ITEMS, ipawsAvailable: true, plumeStats: PLUME_STATS },
    NOW,
  );
  assert.equal(hazmat.ipaws.available, true);
  assert.equal(hazmat.ipaws.delayedByH, 24);
  assert.equal(hazmat.ipaws.items.length, 1);
  assert.equal(hazmat.ipaws.items[0].id, 'ipaws-1');
  assert.equal(hazmat.ipaws.items[0].seenAtMs, NOW - 86_400_000);
  assert.equal(hazmat.plume.active, true);
  assert.equal(hazmat.plume.nodes, 4);
});

test('a plume with no nodes is no scenario running, not a missing quadrant', () => {
  const hazmat = assembleHazmatQuadrant(
    {
      ipawsItems: [],
      ipawsAvailable: true,
      plumeStats: { lastUpdate: NOW - 60_000, count: 0, stale: false },
    },
    NOW,
  );
  assert.equal(hazmat.available, true);
  assert.equal(hazmat.plume.available, true);
  assert.equal(hazmat.plume.active, false);
  assert.equal(hazmat.plume.nodes, 0);
});

test('validateSnapshot flags a malformed snapshot', () => {
  assert.deepEqual(validateSnapshot(null), ['snapshot is not an object']);
  assert.ok(validateSnapshot({}).length > 0);
});
