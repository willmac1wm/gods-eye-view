import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPE_MAY_STARTUP_VIEW,
  NADIR_PITCH_DEG,
  formatsAsNullIsland,
  normalizeSharedCamera,
  normalizeSharpenIntensity,
  normalizeBloomVersion,
  normalizeBloomIntensity,
  normalizePitchDeg,
} from './cameraParams.js';
import { boundedCount } from '../safeCount.js';
import { incidentFlyTarget } from '../local/incidentLink.js';

const productionHash =
  'v=2&lat=0.0000&lon=-0.0000&alt=3500&heading=360&pitch=-90&roll=0&style=normal&bloom=0&sharpen=1&bi=0&bv=2&si=49';

test('the production null-island hash falls back to the Cape May startup view', () => {
  const params = new URLSearchParams(productionHash);
  const camera = normalizeSharedCamera({
    lat: params.get('lat'),
    lon: params.get('lon'),
    alt: params.get('alt'),
    heading: params.get('heading'),
    pitch: params.get('pitch'),
    roll: params.get('roll'),
  });
  assert.deepEqual(camera, { ...CAPE_MAY_STARTUP_VIEW });
  assert.equal(formatsAsNullIsland(0, -0), true);
  assert.equal(camera.pitch, NADIR_PITCH_DEG);
  assert.notEqual(camera.pitch, -90);
});

test('non-finite coordinates are rejected and other axes are clamped', () => {
  for (const raw of [
    { lat: 'NaN', lon: 10 },
    { lat: 10, lon: 'Infinity' },
    { lat: '1e309', lon: 10 },
    { lat: '', lon: 10 },
    { lat: 'nope', lon: 10 },
  ]) {
    assert.equal(normalizeSharedCamera(raw), null);
  }
  const wide = normalizeSharedCamera({
    lat: 120,
    lon: -190,
    alt: 1e20,
    heading: 360,
    pitch: -90,
    roll: 400,
  });
  assert.equal(wide.lat, 90);
  assert.equal(wide.lon, -180);
  assert.equal(wide.alt, 40_000_000);
  assert.equal(wide.heading, 0);
  assert.equal(wide.pitch, -90);
  assert.equal(normalizePitchDeg(-90), NADIR_PITCH_DEG);
  assert.equal(wide.roll, 40);
  const low = normalizeSharedCamera({
    lat: -10,
    lon: 20,
    alt: -5,
    heading: -10,
    pitch: 20,
    roll: -999,
  });
  assert.equal(low.alt, 30);
  assert.equal(low.heading, 350);
  assert.equal(low.pitch, 0);
  assert.equal(low.roll, -999 + 3 * 360);
});

test('integer hash settings reject non-numeric values and clamp to their range', () => {
  assert.equal(normalizeBloomIntensity('Infinity', 0), 0);
  assert.equal(normalizeBloomIntensity(999, 0), 200);
  assert.equal(normalizeBloomIntensity(-4, 0), 0);
  assert.equal(normalizeBloomVersion('nope', 1), 1);
  assert.equal(normalizeBloomVersion(9, 1), 2);
  assert.equal(normalizeSharpenIntensity('NaN', 49), 49);
  assert.equal(normalizeSharpenIntensity(49, 49), 49);
  assert.equal(normalizeSharpenIntensity(1000, 49), 100);
});

test('a missing incident link does not fly, and null island does not either', () => {
  assert.equal(incidentFlyTarget(''), null);
  assert.equal(incidentFlyTarget('?welcome=1'), null);
  assert.equal(incidentFlyTarget('?lat=&lon='), null);
  assert.equal(incidentFlyTarget('?lat=0&lon=0'), null);
  assert.equal(incidentFlyTarget('?lat=0.0000&lon=-0.0000'), null);
  assert.equal(incidentFlyTarget('?lat=NaN&lon=10'), null);
  assert.equal(incidentFlyTarget('?lat=91&lon=10'), null);
  assert.deepEqual(incidentFlyTarget('?lat=38.935&lon=-74.91'), {
    lat: 38.935,
    lon: -74.91,
    height: 3500,
  });
});

test('boundedCount never asks for a length JavaScript will reject', () => {
  assert.equal(boundedCount(NaN), 0);
  assert.equal(boundedCount(Infinity), 0);
  assert.equal(boundedCount(-3), 0);
  assert.equal(boundedCount(3.9), 3);
  assert.equal(boundedCount(1e12, 3000), 3000);
  const particles = [];
  const count = boundedCount(NaN, 3000);
  if (particles.length > count) particles.length = count;
  assert.equal(particles.length, 0);
});
