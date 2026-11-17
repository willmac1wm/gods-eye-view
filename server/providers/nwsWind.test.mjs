import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWindObservation, nwsWindUrl, WIND_STATIONS } from './nwsWind.js';

test('WIND_STATIONS covers the four local ASOS sites', () => {
  assert.deepEqual(
    WIND_STATIONS.map((s) => s.id),
    ['KWWD', 'KACY', 'KMIV', 'KOBI'],
  );
  assert.equal(nwsWindUrl('KWWD'), 'https://api.weather.gov/stations/KWWD/observations/latest');
});

test('parseWindObservation converts km/h to rounded mph', () => {
  const parsed = parseWindObservation(WIND_STATIONS[0], {
    properties: {
      windSpeed: { value: 16.092 }, // 10 mph
      windGust: { value: 24.138 }, // 15 mph
      windDirection: { value: 270 },
      timestamp: '2026-11-16T12:00:00+00:00',
    },
  });
  assert.equal(parsed.id, 'KWWD');
  assert.equal(parsed.mph, 10);
  assert.equal(parsed.gust_mph, 15);
  assert.equal(parsed.dir_deg, 270);
  assert.equal(parsed.time, '2026-11-16T12:00:00+00:00');
});

test('parseWindObservation returns null without a wind speed', () => {
  assert.equal(
    parseWindObservation(WIND_STATIONS[0], {
      properties: { windSpeed: { value: null } },
    }),
    null,
  );
  assert.equal(parseWindObservation(WIND_STATIONS[0], {}), null);
});

test('parseWindObservation tolerates a missing gust and direction', () => {
  const parsed = parseWindObservation(WIND_STATIONS[1], {
    properties: {
      windSpeed: { value: 8.046 }, // 5 mph
      windGust: { value: null },
      windDirection: { value: null },
      timestamp: '2026-11-16T12:00:00+00:00',
    },
  });
  assert.equal(parsed.mph, 5);
  assert.equal(parsed.gust_mph, null);
  assert.equal(parsed.dir_deg, null);
});
