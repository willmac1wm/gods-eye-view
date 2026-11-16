import assert from 'node:assert/strict';
import test from 'node:test';
import { capeAllowed } from './cape.js';

test('capeAllowed permits Place desk soft Fire Wire paths', () => {
  assert.equal(capeAllowed('place'), true);
  assert.equal(capeAllowed('permits'), true);
  assert.equal(capeAllowed('code_enforcement'), true);
});

test('capeAllowed still blocks manager/evidence paths', () => {
  assert.equal(capeAllowed('manager/status'), false);
  assert.equal(capeAllowed('evidence/upload'), false);
  assert.equal(capeAllowed('../place'), false);
});

test('capeAllowed denies paths the strip and desks no longer read', () => {
  // Repointed in the cape-repoint branch: the strip, the board desk and
  // the cape-flood / cape-outages layers read native endpoints now, so
  // these old-app paths are closed. The flood desk still reads
  // floodwatch / flood_gauges / flood_map/plan / storms / sar/flood.
  for (const path of [
    'hazards',
    'storm_status',
    'county-status',
    'county_status',
    'power_outages',
    'board',
    'wx/status',
    'wx/wind',
    'flood_map/tile/10/300/385.png',
  ]) {
    assert.equal(capeAllowed(path), false, path);
  }
});

test('capeAllowed keeps the paths the flood desk still falls back to', () => {
  assert.equal(capeAllowed('floodwatch'), true);
  assert.equal(capeAllowed('flood_gauges'), true);
  assert.equal(capeAllowed('flood_map/plan'), true);
  assert.equal(capeAllowed('storms'), true);
  assert.equal(capeAllowed('sar/flood'), true);
  assert.equal(capeAllowed('radio/feeds'), true);
  assert.equal(capeAllowed('health/sources'), true);
});
