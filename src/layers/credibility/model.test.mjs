import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCredibilityOverlayEntries,
  createCredibilitySummaryEntry,
  mapAnalystRecord,
} from './model.js';

function cluster(overrides = {}) {
  return {
    incidentKey: overrides.incidentKey ?? 'test-incident',
    title: overrides.title ?? 'Test incident',
    severity: 'High',
    credibility: overrides.credibility ?? 90,
    band: overrides.band ?? 'High',
    tier: 1,
    tierLabel: 'Official',
    trend: overrides.trend ?? 'Elevated',
    breakdown: overrides.breakdown ?? [
      { rule: 'highest source tier: Official', points: 90 },
    ],
    sourceCount: 2,
    sources: ['nws_mt_holly_alerts', 'capemay_scanner'],
    lastSeen: 1794800000,
  };
}

test('overlay entries sort Escalating first, then by score', () => {
  const entries = createCredibilityOverlayEntries({
    snapshot: {
      clusters: [
        cluster({ incidentKey: 'a', trend: 'Stabilizing', credibility: 100 }),
        cluster({
          incidentKey: 'b',
          trend: 'Escalating',
          credibility: 60,
          band: 'Medium',
        }),
        cluster({ incidentKey: 'c', trend: 'Elevated', credibility: 95 }),
      ],
    },
  });
  assert.deepEqual(
    entries.map((e) => e.id),
    ['credibility:b', 'credibility:c', 'credibility:a'],
  );
  assert.match(entries[0].title, /60 · Medium · Escalating/);
});

test('overlay entries cap at five and carry the breakdown lines', () => {
  const entries = createCredibilityOverlayEntries({
    snapshot: {
      clusters: Array.from({ length: 7 }, (_, i) =>
        cluster({ incidentKey: `k${i}`, credibility: 90 - i }),
      ),
    },
  });
  assert.equal(entries.length, 5);
  assert.match(entries[0].details.join(' '), /\+90 highest source tier/);
  assert.match(entries[0].details.join(' '), /Source tier: Official/);
  assert.match(entries[0].details.join(' '), /2 sources/);
});

test('summary entry reports the count and the exclusion count', () => {
  const entry = createCredibilitySummaryEntry({
    snapshot: { clusters: [cluster()], excludedCount: 2 },
  });
  assert.match(entry.title, /1 scored alert/);
  assert.match(entry.details.join(' '), /2 blocked-source cluster\(s\) excluded/);
  const empty = createCredibilitySummaryEntry({
    snapshot: { clusters: [], excludedCount: 0 },
  });
  assert.match(empty.title, /No scored alerts/);
  assert.doesNotMatch(empty.details.join(' '), /blocked-source/);
});

test('analyst records carry one row per cluster with the score', () => {
  const record = mapAnalystRecord(cluster(), 0);
  assert.equal(record.id, 'CREDIBILITY-test-incident');
  assert.equal(record.credibility, 90);
  assert.equal(record.band, 'High');
  assert.equal(record.trend, 'Elevated');
  assert.equal(record.source, 'Cape Dispatch credibility scoring');
});
