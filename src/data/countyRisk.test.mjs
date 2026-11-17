import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandForScore,
  COUNTY_TIDE_MINOR_FT,
  scoreCountyRisk,
} from './countyRisk.js';

const NOW = 1794772800000;

function baseInputs(overrides = {}) {
  return {
    nowMs: NOW,
    weather: {
      available: true,
      updatedAtMs: NOW,
      warnings: 0,
      watches: 0,
      advisories: 0,
      topEvents: [],
      tideFt: 2.0,
      tideStage: 'none',
      gauges: [],
    },
    power: {
      available: true,
      updatedAtMs: NOW,
      customersOut: 0,
      customersOut1hAgo: null,
      majorEvent: false,
    },
    hazards: {
      available: true,
      updatedAtMs: NOW,
      gdacsRed: 0,
      gdacsOrange: 0,
      quakeMax: null,
      fireCount: 0,
    },
    lightning: {
      available: true,
      updatedAtMs: NOW,
      flashes30m: 0,
      flashes60m: 0,
    },
    space: { available: true, updatedAtMs: NOW, kp: 3, gScale: null },
    ...overrides,
  };
}

test('all calm inputs score 0, band Low', () => {
  const result = scoreCountyRisk(baseInputs());
  assert.equal(result.score, 0);
  assert.deepEqual(result.band, { level: 1, label: 'Low' });
  assert.deepEqual(result.missingInputs, []);
  assert.equal(result.stale, false);
});

test('NWS warning drives Weather to at least 60', () => {
  const result = scoreCountyRisk(
    baseInputs({ weather: { ...baseInputs().weather, warnings: 1 } }),
  );
  assert.equal(result.components.weather.value, 60);
  assert.ok(result.components.weather.rules.includes('NWS warning active'));
  // 0.4*60 over full weights = 24 → Guarded.
  assert.equal(result.score, 24);
  assert.equal(result.band.label, 'Guarded');
});

test('tide at the 6.2 ft minor-flood line drives Weather to at least 70', () => {
  const atLine = scoreCountyRisk(
    baseInputs({
      weather: {
        ...baseInputs().weather,
        tideFt: COUNTY_TIDE_MINOR_FT,
        tideStage: 'minor',
      },
    }),
  );
  assert.equal(atLine.components.weather.value, 70);
  const below = scoreCountyRisk(
    baseInputs({
      weather: {
        ...baseInputs().weather,
        tideFt: COUNTY_TIDE_MINOR_FT - 0.01,
        tideStage: 'none',
      },
    }),
  );
  assert.equal(below.components.weather.value, 0);
});

test('tide at moderate/major flood stage escalates Weather', () => {
  const moderate = scoreCountyRisk(
    baseInputs({
      weather: { ...baseInputs().weather, tideStage: 'moderate', tideFt: 7.5 },
    }),
  );
  assert.equal(moderate.components.weather.value, 85);
  const major = scoreCountyRisk(
    baseInputs({
      weather: { ...baseInputs().weather, tideStage: 'major', tideFt: 9.0 },
    }),
  );
  assert.equal(major.components.weather.value, 100);
});

test('outages tier by count; 1,000 and rising scores 80', () => {
  const flat = scoreCountyRisk(
    baseInputs({
      power: {
        ...baseInputs().power,
        customersOut: 1500,
        customersOut1hAgo: 1500,
      },
    }),
  );
  assert.equal(flat.components.power.value, 60);
  const rising = scoreCountyRisk(
    baseInputs({
      power: {
        ...baseInputs().power,
        customersOut: 1500,
        customersOut1hAgo: 400,
      },
    }),
  );
  assert.equal(rising.components.power.value, 80);
  assert.ok(
    rising.components.power.rules.includes('Outages ≥ 1,000 and rising'),
  );
  const major = scoreCountyRisk(
    baseInputs({ power: { ...baseInputs().power, majorEvent: true } }),
  );
  assert.equal(major.components.power.value, 80);
});

test('GDACS Red, quakes, and fires drive Hazards', () => {
  const red = scoreCountyRisk(
    baseInputs({ hazards: { ...baseInputs().hazards, gdacsRed: 1 } }),
  );
  assert.equal(red.components.hazards.value, 90);
  const orange = scoreCountyRisk(
    baseInputs({ hazards: { ...baseInputs().hazards, gdacsOrange: 1 } }),
  );
  assert.equal(orange.components.hazards.value, 60);
  const quake = scoreCountyRisk(
    baseInputs({ hazards: { ...baseInputs().hazards, quakeMax: 4.5 } }),
  );
  assert.equal(quake.components.hazards.value, 70);
  const bigQuake = scoreCountyRisk(
    baseInputs({ hazards: { ...baseInputs().hazards, quakeMax: 5.5 } }),
  );
  assert.equal(bigQuake.components.hazards.value, 90);
  const fire = scoreCountyRisk(
    baseInputs({ hazards: { ...baseInputs().hazards, fireCount: 1 } }),
  );
  assert.equal(fire.components.hazards.value, 50);
});

test('lightning tiers by 30-minute count', () => {
  for (const [flashes, expected] of [
    [1, 40],
    [9, 40],
    [10, 70],
    [99, 70],
    [100, 90],
    [300, 100],
  ]) {
    const result = scoreCountyRisk(
      baseInputs({
        lightning: { ...baseInputs().lightning, flashes30m: flashes },
      }),
    );
    assert.equal(result.components.lightning.value, expected, `${flashes}`);
  }
});

test('space weather tiers by Kp, G-scale fallback when Kp is missing', () => {
  for (const [kp, expected] of [
    [4, 0],
    [5, 40],
    [6, 60],
    [7, 80],
    [8, 100],
  ]) {
    const result = scoreCountyRisk(
      baseInputs({ space: { ...baseInputs().space, kp } }),
    );
    assert.equal(result.components.space.value, expected, `Kp ${kp}`);
  }
  const gOnly = scoreCountyRisk(
    baseInputs({ space: { ...baseInputs().space, kp: null, gScale: 'G2' } }),
  );
  assert.equal(gOnly.components.space.value, 60);
});

test('missing components are excluded and weights renormalized', () => {
  const inputs = baseInputs({
    weather: {
      ...baseInputs().weather,
      warnings: 1, // weather 60
    },
    power: { available: false },
    hazards: { available: false },
    lightning: { available: false },
    space: { available: false },
  });
  const result = scoreCountyRisk(inputs);
  // Only weather contributes: 0.4*60 / 0.4 = 60.
  assert.equal(result.score, 60);
  assert.deepEqual(result.missingInputs, [
    'power',
    'hazards',
    'lightning',
    'space',
  ]);
});

test('no inputs at all → no score, never a default 0', () => {
  const inputs = {
    nowMs: NOW,
    weather: { available: false },
    power: { available: false },
    hazards: { available: false },
    lightning: { available: false },
    space: { available: false },
  };
  const result = scoreCountyRisk(inputs);
  assert.equal(result.score, null);
  assert.equal(result.band, null);
  assert.equal(result.missingInputs.length, 5);
});

test('stale input flags the whole score stale', () => {
  const inputs = baseInputs({
    weather: { ...baseInputs().weather, updatedAtMs: NOW - 11 * 60 * 1000 },
  });
  const result = scoreCountyRisk(inputs);
  assert.equal(result.stale, true);
  assert.equal(result.components.weather.stale, true);
  assert.equal(result.components.power.stale, false);
  // A fresh weather reading keeps the score fresh.
  assert.equal(scoreCountyRisk(baseInputs()).stale, false);
});

test('band edges are inclusive at the lower bound', () => {
  assert.deepEqual(bandForScore(19), { level: 1, label: 'Low' });
  assert.deepEqual(bandForScore(20), { level: 2, label: 'Guarded' });
  assert.deepEqual(bandForScore(39), { level: 2, label: 'Guarded' });
  assert.deepEqual(bandForScore(40), { level: 3, label: 'Elevated' });
  assert.deepEqual(bandForScore(59), { level: 3, label: 'Elevated' });
  assert.deepEqual(bandForScore(60), { level: 4, label: 'High' });
  assert.deepEqual(bandForScore(79), { level: 4, label: 'High' });
  assert.deepEqual(bandForScore(80), { level: 5, label: 'Severe' });
  assert.equal(bandForScore(null), null);
  assert.equal(bandForScore(101), null);
});
