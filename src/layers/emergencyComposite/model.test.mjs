import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmergencyCompositeSummaryEntry, getAnalystRecords } from './model.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');

const SNAPSHOT = {
  alerts: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    active: 6,
    warnings: 3,
    watches: 0,
    advisories: 3,
    topEvents: ['Freeze Warning', 'Coastal Flood Advisory'],
    topAlerts: [
      {
        id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
        event: 'Freeze Warning',
        severity: 'Severe',
        timeMs: NOW - 3600_000,
      },
    ],
  },
  incidents: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    activeIncidents: 2,
    quiet: false,
    error: null,
  },
  hazmat: {
    available: true,
    updatedAtMs: NOW - 60_000,
    stale: false,
    ipaws: {
      available: true,
      delayedByH: 24,
      items: [
        {
          id: 'ipaws-1',
          title: 'Tornado Warning',
          severity: 'critical',
          seenAtMs: NOW - 86_400_000,
        },
      ],
      newestAtMs: NOW - 86_400_000,
    },
    plume: {
      available: true,
      active: false,
      nodes: 0,
      updatedAtMs: NOW - 60_000,
      stale: false,
    },
  },
  evacuation: { guidance: null },
  fetchedAt: NOW,
};

test('the summary entry names every quadrant in one line', () => {
  const entry = createEmergencyCompositeSummaryEntry(SNAPSHOT);
  assert.equal(entry.id, 'emergency-composite');
  assert.match(entry.info, /Alerts: 6 active/);
  assert.match(entry.info, /Incidents: 2 active/);
  assert.match(entry.info, /Hazmat: 1 active/);
  assert.match(entry.info, /No evacuation order in effect/);
});

test('a down quadrant reads unavailable in the summary', () => {
  const entry = createEmergencyCompositeSummaryEntry({
    ...SNAPSHOT,
    alerts: { ...SNAPSHOT.alerts, available: false, active: 0 },
  });
  assert.match(entry.info, /Alerts: unavailable/);
});

test('a quiet CAD feed reads quiet in the summary', () => {
  const entry = createEmergencyCompositeSummaryEntry({
    ...SNAPSHOT,
    incidents: { ...SNAPSHOT.incidents, activeIncidents: 0, quiet: true },
  });
  assert.match(entry.info, /Incidents: quiet/);
});

test('evacuation guidance published reads in the summary', () => {
  const entry = createEmergencyCompositeSummaryEntry({
    ...SNAPSHOT,
    evacuation: {
      guidance: {
        text: 'Evacuate the barrier islands.',
        event: 'Hurricane Warning',
        source: 'National Weather Service',
        url: null,
      },
    },
  });
  assert.match(entry.info, /Evacuation guidance published/);
});

test('no snapshot says no data yet', () => {
  const entry = createEmergencyCompositeSummaryEntry(null);
  assert.match(entry.info, /No data yet/);
});

test('analyst records carry one row per NWS alert and IPAWS item', () => {
  const records = getAnalystRecords(SNAPSHOT);
  assert.equal(records.length, 2);
  assert.equal(records[0].event, 'Freeze Warning');
  assert.equal(records[0].source, 'National Weather Service');
  assert.equal(records[1].event, 'Tornado Warning');
  assert.equal(records[1].source, 'FEMA IPAWS');
  assert.equal(getAnalystRecords(null).length, 0);
});
