// src/layers/fishing/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFishingLinks,
  inFishingBox,
  isFishingVessel,
  normalizeFishingRecord,
} from './records.js';
import { gfwMapUrl } from './policy.js';

const IN_BOX = {
  mmsi: '367123456',
  name: 'SEA HARVEST',
  imo: '9169067',
  lat: 39.1,
  lon: -74.9,
  speedKts: 4.2,
  courseDeg: 180,
  shipType: '30',
  destination: 'CAPE MAY',
  lastPositionEpoch: 1_793_123_456_789,
};

test('ship type 30 is fishing; 31/32 towing and other types are not', () => {
  assert.equal(isFishingVessel({ shipType: '30' }), true);
  assert.equal(isFishingVessel({ shipType: 'Fishing' }), true);
  assert.equal(isFishingVessel({ shipType: 'FISHING' }), true);
  assert.equal(isFishingVessel({ shipType: '31' }), false);
  assert.equal(isFishingVessel({ shipType: '32' }), false);
  assert.equal(isFishingVessel({ shipType: '70' }), false);
  assert.equal(isFishingVessel({ shipType: 'Cargo' }), false);
  assert.equal(isFishingVessel({ shipType: '' }), false);
  assert.equal(isFishingVessel({}), false);
});

test('the county box keeps Delaware Bay and drops the open Atlantic', () => {
  assert.equal(inFishingBox({ lat: 39.1, lon: -74.9 }), true);
  assert.equal(inFishingBox({ lat: 38.9, lon: -75.15 }), true);
  assert.equal(inFishingBox({ lat: 39.35, lon: -74.55 }), true);
  assert.equal(inFishingBox({ lat: 39.6, lon: -74.9 }), false);
  assert.equal(inFishingBox({ lat: 39.1, lon: -74.4 }), false);
  assert.equal(inFishingBox({ lat: null, lon: -74.9 }), false);
});

test('normalize keeps a fishing vessel in the box and drops the rest', () => {
  const row = normalizeFishingRecord(IN_BOX);
  assert.equal(row.mmsi, '367123456');
  assert.equal(row.name, 'SEA HARVEST');
  assert.equal(row.shipType, '30');
  assert.equal(row.speedKts, 4.2);
  assert.equal(row.lastSeenMs, 1_793_123_456_789);
  assert.equal(normalizeFishingRecord({ ...IN_BOX, shipType: '70' }), null);
  assert.equal(normalizeFishingRecord({ ...IN_BOX, lat: 40.0 }), null);
  assert.equal(normalizeFishingRecord({ ...IN_BOX, mmsi: '' }), null);
  assert.equal(normalizeFishingRecord(null), null);
});

test('the GFW map link centers on Delaware Bay', () => {
  const url = gfwMapUrl();
  assert.match(url, /^https:\/\/globalfishingwatch\.org\/map\/fishing-activity\/default-public\//);
  assert.match(url, /latitude=39\.12/);
  assert.match(url, /longitude=-74\.85/);
  assert.match(url, /zoom=9/);
  const links = buildFishingLinks();
  assert.equal(links.gfwMap, url);
  assert.equal(links.gfwMapHome, 'https://globalfishingwatch.org/map/');
  assert.equal(links.gfwApis, 'https://globalfishingwatch.org/our-apis/');
});
