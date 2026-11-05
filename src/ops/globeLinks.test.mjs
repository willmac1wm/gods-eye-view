import assert from 'node:assert/strict';
import test from 'node:test';
import { globeHref, GLOBE_VISIBILITY_MATRIX } from './globeLinks.js';

test('globeHref encodes cape layer tokens', () => {
  const href = globeHref({
    lat: 38.935,
    lon: -74.91,
    layers: ['cape-cad', 'cape-flood', 'cape-cameras'],
  });
  assert.match(href, /lat=38\.93500/);
  assert.match(href, /lon=-74\.91000/);
  assert.match(href, /v=2/);
  assert.match(href, /l=02\.04\.03|l=02\.03\.04/);
});

test('globeHref encodes cape-whales share token 0c', () => {
  const href = globeHref({
    lat: 38.9,
    lon: -74.8,
    layers: ['cape-whales'],
  });
  assert.match(href, /v=2/);
  assert.match(href, /l=0c/);
});

test('globe visibility matrix covers key desks', () => {
  const desks = GLOBE_VISIBILITY_MATRIX.map((r) => r.desk).join(' ');
  assert.match(desks, /CAD/);
  assert.match(desks, /Cameras/);
  assert.match(desks, /Flood/);
  assert.match(desks, /Whales/);
  const whales = GLOBE_VISIBILITY_MATRIX.find((r) => r.desk === 'Whales');
  assert.equal(whales.status, 'live');
  assert.match(whales.handoff, /0c/);
});
