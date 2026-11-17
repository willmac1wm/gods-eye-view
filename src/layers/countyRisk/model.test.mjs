import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCountyRiskOverlayEntries,
  createCountyRiskSummaryEntry,
  mapAnalystRecord,
} from './model.js';

function snapshot(overrides = {}) {
  return {
    score: 52,
    band: { level: 3, label: 'Elevated' },
    components: {
      weather: { available: true, value: 70, rules: ['NWS warning active'], stale: false, updatedAtMs: 1000 },
      power: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
      hazards: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
      lightning: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
      space: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
    },
    missingInputs: ['lightning'],
    stale: false,
    computedAtMs: 1000,
    ...overrides,
  };
}

test('summary entry carries the score, band, and missing inputs', () => {
  const entry = createCountyRiskSummaryEntry({ snapshot: snapshot() });
  assert.equal(entry.id, 'county-risk:summary');
  assert.match(entry.title, /Elevated 52\/100/);
  assert.ok(entry.details.some((d) => d.includes('Lightning')));
  assert.ok(entry.details.some((d) => d.includes('NWS warning active')));
  assert.equal(entry.variant, 'label');
});

test('summary entry says unavailable when there is no score', () => {
  const entry = createCountyRiskSummaryEntry({
    snapshot: snapshot({ score: null, band: null, missingInputs: ['weather', 'power', 'hazards', 'lightning', 'space'] }),
  });
  assert.match(entry.title, /unavailable/);
});

test('overlay entries cover only the available components', () => {
  const entries = createCountyRiskOverlayEntries({ snapshot: snapshot() });
  assert.equal(entries.length, 4);
  assert.ok(entries.every((e) => e.id.startsWith('county-risk:')));
  const weather = entries.find((e) => e.id === 'county-risk:weather');
  assert.match(weather.title, /Weather 70/);
  assert.ok(!entries.some((e) => e.id === 'county-risk:lightning'));
});

test('mapAnalystRecord flattens the snapshot for the query engine', () => {
  const record = mapAnalystRecord(snapshot(), 0);
  assert.equal(record.id, 'COUNTY-RISK-0000');
  assert.equal(record.score, 52);
  assert.equal(record.band, 'Elevated');
  assert.equal(record.bandLevel, 3);
  assert.equal(record.components.weather, 70);
  assert.equal(record.components.lightning, null);
  assert.deepEqual(record.missingInputs, ['lightning']);
  assert.equal(record.timeMs, 1000);
  assert.equal(mapAnalystRecord(null), null);
});
