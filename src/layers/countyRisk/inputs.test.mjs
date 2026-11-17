import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNwsAlert,
  distanceKm,
  readCountyRiskInputs,
} from './inputs.js';

const NOW = 1794772800000;

function layer({ records = [], stats = null } = {}) {
  return {
    getAnalystRecords: () => records,
    getStats: () => stats,
  };
}

test('distanceKm: Cape May to Atlantic City is about 63 km', () => {
  const km = distanceKm(38.94, -74.91, 39.36, -74.42);
  assert.ok(km > 60 && km < 66, `got ${km}`);
});

test('classifyNwsAlert: warning/watch/advisory by event name and severity', () => {
  assert.equal(classifyNwsAlert({ event: 'Coastal Flood Warning' }), 'warning');
  assert.equal(
    classifyNwsAlert({ event: 'Flood Watch', severity: 'Moderate' }),
    'watch',
  );
  assert.equal(
    classifyNwsAlert({ event: 'Freeze Warning', severity: 'Minor' }),
    'warning',
  );
  assert.equal(
    classifyNwsAlert({ event: 'Small Craft Advisory' }),
    'advisory',
  );
  assert.equal(
    classifyNwsAlert({ event: 'Special Weather Statement' }),
    'advisory',
  );
  assert.equal(
    classifyNwsAlert({ event: 'Red Flag Warning', severity: 'Severe' }),
    'warning',
  );
  assert.equal(classifyNwsAlert({ event: 'Heat Advisory' }), 'advisory');
  assert.equal(classifyNwsAlert({ event: 'Something Else' }), null);
});

test('weather: NWS counts + tide stage from the record, gauges unscored', () => {
  const inputs = readCountyRiskInputs(
    {
      nwsAlertCard: layer({
        records: [
          { event: 'Coastal Flood Warning', severity: 'Moderate' },
          { event: 'Freeze Watch', severity: 'Moderate' },
          { event: 'Small Craft Advisory', severity: 'Minor' },
        ],
        stats: { count: 3, lastUpdate: NOW },
      }),
      tides: layer({
        records: [
          {
            observedFtMllw: 6.5,
            floodStage: 'minor',
            trend: 'rising',
            timeMs: NOW,
          },
        ],
        stats: { count: 1, lastUpdate: NOW },
      }),
      gauges: layer({
        records: [{ site: 'Great Egg Harbor River', gageHeightFt: 4.23 }],
        stats: { count: 1, lastUpdate: NOW },
      }),
    },
    NOW,
  );
  assert.equal(inputs.weather.available, true);
  assert.equal(inputs.weather.warnings, 1);
  assert.equal(inputs.weather.watches, 1);
  assert.equal(inputs.weather.advisories, 1);
  assert.equal(inputs.weather.tideFt, 6.5);
  assert.equal(inputs.weather.tideStage, 'minor');
  assert.equal(inputs.weather.gauges.length, 1);
  assert.equal(inputs.weather.gauges[0].gageHeightFt, 4.23);
  assert.equal(inputs.lightning.available, false);
});

test('weather: the 6.2 ft line fires even when the stage is missing', () => {
  const inputs = readCountyRiskInputs(
    {
      tides: layer({
        records: [{ observedFtMllw: 6.2, floodStage: 'none', timeMs: NOW }],
        stats: { count: 1, lastUpdate: NOW },
      }),
    },
    NOW,
  );
  assert.equal(inputs.weather.tideStage, 'minor');
  const below = readCountyRiskInputs(
    {
      tides: layer({
        records: [{ observedFtMllw: 6.19, floodStage: 'none', timeMs: NOW }],
        stats: { count: 1, lastUpdate: NOW },
      }),
    },
    NOW,
  );
  assert.equal(below.weather.tideStage, 'none');
});

test('power: customers out + major event from stats', () => {
  const inputs = readCountyRiskInputs(
    {
      outages: layer({
        records: [{ customersOut: 1500 }],
        stats: { count: 5, customersOut: 1500, majorEvent: false, lastUpdate: NOW },
      }),
    },
    NOW,
  );
  assert.equal(inputs.power.available, true);
  assert.equal(inputs.power.customersOut, 1500);
  assert.equal(inputs.power.customersOut1hAgo, null);
  assert.equal(inputs.power.majorEvent, false);
});

test('hazards: GDACS Red in the county, Orange outside the 100 km ring ignored', () => {
  const inputs = readCountyRiskInputs(
    {
      gdacs: layer({
        records: [
          { alertLevel: 'Red', lat: 39.0, lon: -74.8, title: 'in county' },
          { alertLevel: 'Orange', lat: 41.0, lon: -74.0, title: 'far away' },
          { alertLevel: 'Orange', lat: 39.5, lon: -74.0, title: 'in the ring' },
        ],
        stats: { count: 3, lastUpdate: NOW },
      }),
      earthquakes: layer({
        records: [
          { magnitude: 4.5, lat: 39.1, lon: -74.9, timeMs: NOW },
          { magnitude: 6.0, lat: 42.0, lon: -74.0, timeMs: NOW },
        ],
        stats: { count: 2, lastUpdate: NOW },
      }),
      firms: layer({
        records: [
          { lat: 39.05, lon: -74.8, frp: 12, acqTime: NOW },
          { lat: 40.5, lon: -74.0, frp: 50, acqTime: NOW },
        ],
      }),
    },
    NOW,
  );
  assert.equal(inputs.hazards.available, true);
  assert.equal(inputs.hazards.gdacsRed, 1);
  assert.equal(inputs.hazards.gdacsOrange, 1);
  assert.equal(inputs.hazards.quakeMax, 4.5);
  assert.equal(inputs.hazards.fireCount, 1);
});

test('space: Kp from stats, G-scale fallback from records', () => {
  const withKp = readCountyRiskInputs(
    {
      spaceWeather: layer({
        records: [{ kp: 6, gScale: 'G2', timeMs: NOW }],
        stats: { count: 1, kp: 6, gScale: 'G2', lastUpdate: NOW },
      }),
    },
    NOW,
  );
  assert.equal(withKp.space.kp, 6);
  assert.equal(withKp.space.gScale, 'G2');
  const noStats = readCountyRiskInputs(
    {
      spaceWeather: {
        getAnalystRecords: () => [{ kp: null, gScale: 'G1', timeMs: NOW }],
        getStats: () => null,
      },
    },
    NOW,
  );
  assert.equal(noStats.space.available, true);
  assert.equal(noStats.space.kp, null);
  assert.equal(noStats.space.gScale, 'G1');
});

test('disabled or throwing layers read as missing, never a crash', () => {
  const inputs = readCountyRiskInputs(
    {
      nwsAlertCard: { getAnalystRecords: () => [], getStats: () => null },
      tides: {
        getAnalystRecords: () => {
          throw new Error('boom');
        },
        getStats: () => {
          throw new Error('boom');
        },
      },
      outages: null,
    },
    NOW,
  );
  assert.equal(inputs.weather.available, false);
  assert.equal(inputs.power.available, false);
  assert.equal(inputs.hazards.available, false);
  assert.equal(inputs.space.available, false);
});
