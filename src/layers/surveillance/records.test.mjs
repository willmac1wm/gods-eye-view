import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOverpassQuery,
  isSurveillanceCamera,
  normalizeSurveillanceElement,
  validateSurveillanceSnapshot,
} from './records.js';

// Live county fixtures, verified against Overpass 2026-11-16 (bbox lat
// 38.90–39.35, lon −75.15–−74.55). OSM ids, coordinates and tags are real.
const COUNTY_CAMERA_BARE = {
  type: 'node',
  id: 13116656753,
  lat: 38.9326358,
  lon: -74.9230437,
  tags: {
    man_made: 'surveillance',
    'surveillance:type': 'camera',
  },
};

const COUNTY_CAMERA_POLE = {
  type: 'node',
  id: 14077264754,
  lat: 39.0346601,
  lon: -74.7705174,
  tags: {
    'camera:direction': '300',
    'camera:mount': 'pole',
    'camera:type': 'fixed',
    man_made: 'surveillance',
    surveillance: 'public,_outdoor',
    'surveillance:type': 'camera',
    'surveillance:zone': 'parking',
  },
};

const COUNTY_ALPR = {
  type: 'node',
  id: 13179164589,
  lat: 39.0115979,
  lon: -74.8851915,
  tags: {
    'camera:type': 'fixed',
    direction: '50',
    man_made: 'surveillance',
    manufacturer: 'Flock Safety',
    'surveillance:type': 'ALPR',
  },
};

test('the query asks Overpass for every surveillance feature in the box', () => {
  assert.equal(
    buildOverpassQuery(38.9, -75.15, 39.35, -74.55),
    '[out:json][timeout:20];' +
      '(node["man_made"="surveillance"](38.9,-75.15,39.35,-74.55);' +
      'way["man_made"="surveillance"](38.9,-75.15,39.35,-74.55););' +
      'out center tags;',
  );
});

test('both live county cameras normalize; ALPR and guard features drop', () => {
  const bare = normalizeSurveillanceElement(COUNTY_CAMERA_BARE);
  assert.equal(bare.id, 'surv:13116656753');
  assert.equal(bare.latitude, 38.9326358);
  assert.equal(bare.longitude, -74.9230437);
  assert.equal(bare.directionDeg, null);
  assert.equal(bare.lastVerified, null);

  const pole = normalizeSurveillanceElement(COUNTY_CAMERA_POLE);
  assert.equal(pole.id, 'surv:14077264754');
  assert.equal(pole.manufacturer, null);
  assert.equal(pole.cameraType, 'fixed');
  assert.equal(pole.zone, 'parking');
  assert.equal(pole.directionDeg, 300);

  // ALPR belongs to the alpr-cameras layer, never this one.
  assert.equal(normalizeSurveillanceElement(COUNTY_ALPR), null);
  assert.equal(
    normalizeSurveillanceElement({
      type: 'node',
      id: 7,
      lat: 39,
      lon: -74.8,
      tags: {
        man_made: 'surveillance',
        'surveillance:type': 'guard',
      },
    }),
    null,
  );
  // Semicolon multi-values still match; ALPR anywhere in the list excludes.
  assert.equal(
    isSurveillanceCamera({ 'surveillance:type': 'camera;ALPR' }),
    false,
  );
  assert.equal(isSurveillanceCamera({ surveillance: 'camera' }), true);
  assert.equal(
    isSurveillanceCamera({ 'surveillance:type': 'CAMERA' }),
    true,
  );
  assert.equal(isSurveillanceCamera({}), false);
  assert.equal(isSurveillanceCamera(null), false);
});

test('ways normalize from center coordinates', () => {
  const record = normalizeSurveillanceElement({
    type: 'way',
    id: 99,
    center: { lat: 39.1, lon: -74.8 },
    tags: { man_made: 'surveillance', 'surveillance:type': 'camera' },
  });
  assert.equal(record.id, 'surv:99');
  assert.equal(record.latitude, 39.1);
  assert.equal(record.longitude, -74.8);
  assert.equal(
    normalizeSurveillanceElement({
      type: 'way',
      id: 100,
      tags: { man_made: 'surveillance', 'surveillance:type': 'camera' },
    }),
    null,
  );
});

test('invalid coordinates and bad ids drop instead of plotting', () => {
  for (const bad of [
    { ...COUNTY_CAMERA_BARE, lat: 91 },
    { ...COUNTY_CAMERA_BARE, lon: -181 },
    { ...COUNTY_CAMERA_BARE, id: -1 },
    { ...COUNTY_CAMERA_BARE, tags: {} },
    null,
  ]) {
    assert.equal(normalizeSurveillanceElement(bad), null);
  }
});

test('snapshots reject malformed coordinates and duplicate identities', () => {
  const record = { id: 'surv:1', latitude: 39, longitude: -74.8 };
  for (const records of [
    [{ ...record, latitude: NaN }],
    [record, record],
    [{ ...record, id: '' }],
    [{ ...record, directionDeg: 360 }],
  ]) {
    assert.throws(
      () =>
        validateSurveillanceSnapshot({
          records,
          stale: false,
          saturated: false,
        }),
      /invalid record/,
    );
  }
  assert.throws(
    () => validateSurveillanceSnapshot({ elements: [] }),
    /invalid snapshot/,
  );
});
