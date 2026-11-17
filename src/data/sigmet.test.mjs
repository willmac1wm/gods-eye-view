import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatSigmetValidRange,
  hazardColorCss,
  flightLevelToMeters,
  mapSigmetFeature,
  polygonPartsFromGeometry,
  DEFAULT_EXTRUDE_TOP_M,
  FLIGHT_LEVEL_TO_METERS,
  SIGMET_PROXY_PATH,
  SIGMET_UPSTREAM_URL,
} from './sigmet.js';

test('SIGMET valid window formats unix seconds as UTC', () => {
  assert.equal(
    formatSigmetValidRange(1700000000, 1700003600),
    '2023-11-14 22:13:20Z – 2023-11-14 23:13:20Z',
  );
  assert.equal(formatSigmetValidRange(null, null), null);
});

test('SIGMET hazard colors are stable per class and fall back to WorldView orange', () => {
  assert.equal(hazardColorCss('TURB'), '#ff9f0a');
  assert.equal(hazardColorCss('ts'), '#ff3b30');
  assert.equal(hazardColorCss('unknown-hazard'), '#ff6600');
});

test('SIGMET flight levels convert hundreds of feet; missing top uses 15 km default', () => {
  assert.equal(flightLevelToMeters(100, 0), 100 * FLIGHT_LEVEL_TO_METERS);
  assert.equal(
    flightLevelToMeters(0, DEFAULT_EXTRUDE_TOP_M),
    DEFAULT_EXTRUDE_TOP_M,
  );
  assert.equal(flightLevelToMeters(null, 0), 0);
});

test('SIGMET geometry keeps Polygon and MultiPolygon rings, skips lines', () => {
  const polygon = polygonPartsFromGeometry({
    type: 'Polygon',
    coordinates: [
      [
        [-100, 40],
        [-99, 40],
        [-99, 41],
        [-100, 41],
        [-100, 40],
      ],
    ],
  });
  assert.equal(polygon.length, 1);
  assert.equal(polygon[0].outer.length, 5);
  const multi = polygonPartsFromGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-10, 10],
          [-9, 10],
          [-9, 11],
          [-10, 11],
          [-10, 10],
        ],
      ],
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    ],
  });
  assert.equal(multi.length, 2);
  assert.deepEqual(
    polygonPartsFromGeometry({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    }),
    [],
  );
});

test('SIGMET feature maps hazard, valid time, and extrusion for the HUD card', () => {
  const records = mapSigmetFeature({
    id: 'KZNY-A',
    properties: {
      hazard: 'TURB',
      icaoId: 'KZNY',
      airspace: 'NEW YORK FIR',
      validTimeFrom: 1700000000,
      validTimeTo: 1700003600,
      base: 100,
      top: 400,
      qualifier: 'SEV',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-74, 40],
          [-73, 40],
          [-73, 41],
          [-74, 41],
          [-74, 40],
        ],
      ],
    },
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].hazard, 'TURB');
  assert.match(records[0].validLabel, /2023-11-14/);
  assert.equal(records[0].airspace, 'NEW YORK FIR');
  assert.ok(records[0].topM > records[0].baseM);
  assert.equal(records[0].accent, '#ff9f0a');
});

test('SIGMET layer talks to the same-origin proxy, not the AWC host directly', () => {
  const source = readFileSync(new URL('./sigmet.js', import.meta.url), 'utf8');
  assert.equal(SIGMET_PROXY_PATH, '/api/aviation/isigmet');
  assert.match(SIGMET_UPSTREAM_URL, /aviationweather\.gov\/api\/data\/isigmet/);
  assert.match(source, /fetch\(SIGMET_PROXY_PATH/);
  assert.doesNotMatch(source, /fetch\(SIGMET_UPSTREAM_URL/);
  assert.doesNotMatch(source, /GPS_JAM|kinetic|ATC slider/i);
});
