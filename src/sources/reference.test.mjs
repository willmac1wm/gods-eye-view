import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceSources } from './reference.js';
import { createStandaloneReferenceSources } from '../standalone/layerSources.js';

test('reference factories retain compatibility without starting acquisition or sharing instances', (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => {
    requests++;
    throw new Error('unexpected acquisition');
  });
  assert.equal(createReferenceSources, createStandaloneReferenceSources);
  const first = createReferenceSources();
  const second = createReferenceSources();
  assert.deepEqual(Object.keys(first), [
    'earthquakes',
    'sar-flood',
    'air-quality',
    'faa-status',
    'fire-perimeters',
    'drone-airspace',
    'wildlife-sightings',
    'cables',
    'gnss-integrity',
    'tides',
    'outages',
    'fuel-prices',
    'aprs-weather',
    'marine-warnings',
    'gdacs-hazards',
    'internet-outages',
    'hifld-installations',
    'outbreaks',
    'fallout-plume',
    'credibility-scoring',
    'county-risk',
    'daily-brief',
    'readiness',
    'satellite-verification',
    'alpr-avoidance-routing',
    'history-replay',
    'satnogs',
    'gpsjam-daily',
    'vdl2',
    'water-gauges',
    'surveillance-cameras',
    'disaster-history',
    'traffic-cameras',
    'nws-alert-card',
    'space-weather',
    'drought',
    'radiation',
    'sanctions-watch',
    'navarea-warnings',
    'ports',
  ]);
  assert.notEqual(first.earthquakes, second.earthquakes);
  assert.notEqual(first['air-quality'], second['air-quality']);
  assert.notEqual(first['fire-perimeters'], second['fire-perimeters']);
  assert.notEqual(first['drone-airspace'], second['drone-airspace']);
  assert.notEqual(first['wildlife-sightings'], second['wildlife-sightings']);
  assert.notEqual(first.cables, second.cables);
  assert.notEqual(first['gnss-integrity'], second['gnss-integrity']);
  assert.notEqual(first.tides, second.tides);
  assert.notEqual(first['aprs-weather'], second['aprs-weather']);
  assert.notEqual(first['marine-warnings'], second['marine-warnings']);
  assert.notEqual(first.satnogs, second.satnogs);
  assert.notEqual(first['gpsjam-daily'], second['gpsjam-daily']);
  assert.notEqual(first.vdl2, second.vdl2);
  assert.equal(typeof first.earthquakes.getSnapshot, 'function');
  assert.equal(typeof first['air-quality'].getSnapshot, 'function');
  assert.equal(typeof first['fire-perimeters'].getSnapshot, 'function');
  assert.equal(typeof first['drone-airspace'].getSnapshot, 'function');
  assert.equal(typeof first['wildlife-sightings'].getSnapshot, 'function');
  assert.equal(typeof first.cables.fetch, 'function');
  assert.equal(typeof first['gnss-integrity'].getSnapshot, 'function');
  assert.equal(typeof first.tides.getSnapshot, 'function');
  assert.equal(typeof first['aprs-weather'].getSnapshot, 'function');
  assert.equal(typeof first['marine-warnings'].getSnapshot, 'function');
  assert.equal(typeof first.satnogs.getSnapshot, 'function');
  assert.equal(typeof first['gpsjam-daily'].getSnapshot, 'function');
  assert.equal(typeof first.vdl2.getSnapshot, 'function');
  assert.equal(typeof first['water-gauges'].getSnapshot, 'function');
  assert.equal(typeof first['surveillance-cameras'].fetch, 'function');
  assert.equal(typeof first['disaster-history'].getSnapshot, 'function');
  assert.equal(typeof first['traffic-cameras'].getSnapshot, 'function');
  assert.equal(typeof first['nws-alert-card'].getSnapshot, 'function');
  assert.equal(typeof first['space-weather'].getSnapshot, 'function');
  assert.equal(typeof first['drought'].getSnapshot, 'function');
  assert.equal(typeof first['radiation'].getSnapshot, 'function');
  assert.equal(typeof first['sanctions-watch'].screenVessel, 'function');
  assert.equal(typeof first['credibility-scoring'].getSnapshot, 'function');
  assert.equal(typeof first['county-risk'].getSnapshot, 'function');
  assert.equal(typeof first['history-replay'].getStatus, 'function');
  assert.equal(typeof first['history-replay'].getWindow, 'function');
  assert.equal(typeof first['navarea-warnings'].getSnapshot, 'function');
  assert.equal(typeof first['ports'].getSnapshot, 'function');
  assert.equal(requests, 0);
});
