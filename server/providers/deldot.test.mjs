import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseHeading,
  parseArcGisCamera,
  parseTmcCameras,
  ferryTrafficSeed,
} from './deldot.js';

test('ferryTrafficSeed carries the 10 DRBA webcams plus the harbour and bridge pins', () => {
  const seed = ferryTrafficSeed();
  assert.equal(seed.length, 15);
  assert.equal(seed[0].source, 'Cape May-Lewes Ferry (DRBA)');
  assert.equal(seed[0].stream_url.includes('playlist.m3u8'), true);
  const bridges = seed.filter((cam) => String(cam.source).includes('Bridge Commission'));
  assert.equal(bridges.length, 4);
  assert.equal(bridges[0].image_url, null);
});

test('parseHeading prefers a numeric heading field, then compass words', () => {
  assert.deepEqual(parseHeading('Cam', { HEADING: '270' }), [270, 60, 'high']);
  assert.deepEqual(parseHeading('Cam', { Azimuth: 45.5 }), [45.5, 60, 'high']);
  assert.deepEqual(parseHeading('Route 47 NB', {}), [0, 60, 'estimated']);
  assert.deepEqual(parseHeading('Ocean Dr EASTBOUND', {}), [90, 60, 'estimated']);
  assert.deepEqual(parseHeading('Plain camera', {}), [null, 60, 'estimated']);
});

test('parseArcGisCamera tries field-name variants and keeps the rest in extra', () => {
  const parsed = parseArcGisCamera({
    geometry: { coordinates: [-75.12, 38.78] },
    properties: {
      PUBLIC_NAME: 'Lewes Camera',
      MAINROAD: 'Cape Henlopen Dr',
      ImageURL: 'https://example.com/cam.jpg',
      SYSTEM_STATUS: 'ACTIVE',
      ODD_FIELD: 'kept',
    },
  });
  assert.equal(parsed.name, 'Lewes Camera');
  assert.equal(parsed.road, 'Cape Henlopen Dr');
  assert.equal(parsed.image_url, 'https://example.com/cam.jpg');
  assert.equal(parsed.source, 'DelDOT');
  assert.equal(parsed.extra.ODD_FIELD, 'kept');
  assert.equal(parsed.extra.SYSTEM_STATUS, 'ACTIVE');
  assert.equal(parseArcGisCamera({ geometry: null }), null);
  assert.equal(parseArcGisCamera({ geometry: { coordinates: [-75.12] } }), null);
});

test('parseTmcCameras keeps Sussex County and the corridor, drops the rest', () => {
  const rows = parseTmcCameras({
    videoCameras: [
      {
        id: 1,
        title: 'SR-1 @ Lewes',
        lat: 38.78,
        lon: -75.12,
        county: 'Sussex',
        enabled: true,
        urls: { m3u8s: 'https://example.com/a.m3u8' },
      },
      {
        id: 2,
        title: 'I-95 @ Wilmington NB',
        lat: 39.7,
        lon: -75.55,
        county: 'New Castle',
        enabled: true,
        urls: { m3u8: 'https://example.com/b.m3u8' },
      },
      {
        id: 3,
        title: 'Disabled cam',
        lat: 38.78,
        lon: -75.12,
        county: 'Sussex',
        enabled: false,
        urls: {},
      },
      {
        id: 4,
        title: 'US-9 @ Lewes',
        lat: 38.85,
        lon: -75.05,
        county: 'Kent',
        enabled: true,
        urls: { rtmp: 'rtmp://example.com/c' },
      },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'SR-1 @ Lewes');
  assert.equal(rows[0].image_url, 'https://example.com/a.m3u8');
  assert.equal(rows[0].source, 'DelDOT TMC');
  assert.equal(rows[1].name, 'US-9 @ Lewes');
  assert.equal(rows[1].heading, null);
});
