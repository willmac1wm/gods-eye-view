import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOMTOM_INCIDENT_BBOX,
  TOMTOM_INCIDENT_FIELDS,
  thinIncidentLine,
  normalizeTomTomIncident,
} from './traffic.js';

test('TOMTOM_INCIDENT_BBOX covers the county plus its approach corridors', () => {
  assert.deepEqual(TOMTOM_INCIDENT_BBOX, [-75.25, 38.85, -74.4, 39.55]);
  assert.ok(TOMTOM_INCIDENT_FIELDS.includes('magnitudeOfDelay'));
});

test('thinIncidentLine caps long lines at 60 points and keeps the ends', () => {
  const line = Array.from({ length: 121 }, (_, i) => [i, i]);
  const thinned = thinIncidentLine(line);
  assert.ok(thinned.length <= 61);
  assert.deepEqual(thinned[0], [0, 0]);
  assert.deepEqual(thinned[thinned.length - 1], [120, 120]);
  assert.deepEqual(thinIncidentLine([[1, 2]]), [[1, 2]]);
});

test('normalizeTomTomIncident maps a LineString jam to the mapTomTom shape', () => {
  const row = normalizeTomTomIncident({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-74.9, 39.0],
        [-74.85, 39.01],
        [-74.8, 39.02],
      ],
    },
    properties: {
      id: 'abc123',
      iconCategory: 6,
      magnitudeOfDelay: 3,
      events: [{ description: 'Congestion' }, { description: 'Lane closed' }],
      startTime: '2026-11-16T10:00:00Z',
      endTime: null,
      from: 'Cape May',
      to: 'Wildwood',
      length: 1500,
      delay: 300,
      roadNumbers: ['US-9'],
      lastReportTime: '2026-11-16T11:00:00Z',
    },
  });
  assert.equal(row.id, 'abc123');
  assert.equal(row.category, 'Traffic jam');
  assert.equal(row.magnitude, 'Major');
  assert.equal(row.description, 'Congestion; Lane closed');
  assert.deepEqual(row.roads, ['US-9']);
  assert.equal(row.delay_s, 300);
  assert.equal(row.length_m, 1500);
  // Mid-point of the line, [lat, lng] pairs in the line.
  assert.equal(row.lat, 39.01);
  assert.equal(row.lng, -74.85);
  assert.deepEqual(row.line, [
    [39.0, -74.9],
    [39.01, -74.85],
    [39.02, -74.8],
  ]);
});

test('normalizeTomTomIncident maps a Point accident and rejects the rest', () => {
  const row = normalizeTomTomIncident({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-74.9, 39.0] },
    properties: {
      id: 'p1',
      iconCategory: 1,
      magnitudeOfDelay: 2,
      events: [],
    },
  });
  assert.equal(row.category, 'Accident');
  assert.equal(row.magnitude, 'Moderate');
  assert.equal(row.line.length, 1);
  assert.equal(
    normalizeTomTomIncident({
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {},
    }),
    null,
  );
  assert.equal(normalizeTomTomIncident({ geometry: {}, properties: {} }), null);
  assert.equal(normalizeTomTomIncident(null), null);
});
