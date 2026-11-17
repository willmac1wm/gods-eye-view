import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatComponentLine,
  normalizeCountyRiskSnapshot,
  validateCountyRiskSnapshot,
} from './records.js';

function snapshot(overrides = {}) {
  return {
    score: 52,
    band: { level: 3, label: 'Elevated' },
    components: {
      weather: { available: true, value: 70, rules: ['NWS warning active'], stale: false, updatedAtMs: 1000 },
      power: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
      hazards: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
      lightning: { available: true, value: 40, rules: ['Lightning in the county in the last 30 min'], stale: false, updatedAtMs: 1000 },
      space: { available: true, value: 0, rules: [], stale: false, updatedAtMs: 1000 },
    },
    missingInputs: [],
    stale: false,
    computedAtMs: 1000,
    inputs: null,
    ...overrides,
  };
}

test('a full snapshot normalizes with all five components', () => {
  const normalized = normalizeCountyRiskSnapshot(snapshot());
  assert.equal(normalized.score, 52);
  assert.equal(normalized.band.label, 'Elevated');
  assert.equal(normalized.components.weather.value, 70);
  assert.deepEqual(normalized.missingInputs, []);
});

test('a no-score snapshot normalizes (unavailable is valid, not malformed)', () => {
  const normalized = normalizeCountyRiskSnapshot(
    snapshot({
      score: null,
      band: null,
      components: {
        weather: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
        power: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
        hazards: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
        lightning: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
        space: { available: false, value: null, rules: [], stale: false, updatedAtMs: null },
      },
      missingInputs: ['weather', 'power', 'hazards', 'lightning', 'space'],
    }),
  );
  assert.equal(normalized.score, null);
  assert.equal(normalized.band, null);
  assert.equal(normalized.missingInputs.length, 5);
  assert.equal(validateCountyRiskSnapshot(normalized)?.score, null);
});

test('malformed snapshots are rejected', () => {
  assert.equal(normalizeCountyRiskSnapshot(null), null);
  assert.equal(normalizeCountyRiskSnapshot({}), null);
  assert.equal(normalizeCountyRiskSnapshot(snapshot({ score: 101 })), null);
  assert.equal(normalizeCountyRiskSnapshot(snapshot({ score: '52' })), null);
  const missingComponent = snapshot();
  delete missingComponent.components.space;
  assert.equal(normalizeCountyRiskSnapshot(missingComponent), null);
  const badComponent = snapshot();
  badComponent.components.weather = { available: 'yes', value: 70 };
  assert.equal(normalizeCountyRiskSnapshot(badComponent), null);
  assert.equal(validateCountyRiskSnapshot(null), null);
});

test('formatComponentLine carries the value and the top rules', () => {
  assert.equal(
    formatComponentLine('Weather', {
      available: true,
      value: 70,
      rules: ['NWS warning active', 'Tide ≥ 6.2 ft (minor flood)'],
    }),
    'Weather 70 — NWS warning active; Tide ≥ 6.2 ft (minor flood)',
  );
  assert.equal(
    formatComponentLine('Power', { available: true, value: 0, rules: [] }),
    'Power 0',
  );
  assert.equal(
    formatComponentLine('Lightning', { available: false, value: null }),
    'Lightning: no data',
  );
});
