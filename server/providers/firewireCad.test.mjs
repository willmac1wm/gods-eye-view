import assert from 'node:assert/strict';
import test from 'node:test';
import { mapFireWireIncident } from './firewireCad.js';

const ROW = {
  id: 11617,
  incident_type: 'Medevac Flight Operation',
  priority: 'high',
  municipality: 'Atlantic City Airspace (KACY)',
  location: 'KACY Tower (120.3) Airspace',
  lat: 39.4576,
  lng: -74.5772,
  confidence: 0.95,
  sensitive: false,
  public_summary: 'One thirty four seventy five, Medevac, correct, thank you.',
  status: 'published',
  transmission_count: 1,
  known_units: '["Rescue 6547"]',
  audio_url: '/audio/kacy_1794791050.mp3',
  created_at: '2026-11-16T01:04:10',
  last_transmission_at: '2026-11-16T01:04:10',
};

test('mapFireWireIncident maps a live Fire Wire row to the mapCad shape', () => {
  const mapped = mapFireWireIncident(ROW);
  assert.equal(mapped.id, 11617);
  assert.equal(mapped.type, 'Medevac Flight Operation');
  assert.equal(mapped.location, 'KACY Tower (120.3) Airspace');
  assert.equal(mapped.municipality, 'Atlantic City Airspace (KACY)');
  assert.equal(mapped.priority, 'high');
  assert.equal(mapped.timestamp, '2026-11-16T01:04:10');
  assert.equal(mapped.audio_url, '/audio/kacy_1794791050.mp3');
  assert.equal(mapped.summary, 'One thirty four seventy five, Medevac, correct, thank you.');
  assert.deepEqual(mapped.units, ['Rescue 6547']);
});

test('mapFireWireIncident drops sensitive rows and rows without coordinates', () => {
  assert.equal(mapFireWireIncident({ ...ROW, sensitive: true }), null);
  assert.equal(mapFireWireIncident({ ...ROW, lat: null }), null);
  assert.equal(mapFireWireIncident({ ...ROW, lng: 'not-a-number' }), null);
  assert.equal(mapFireWireIncident(null), null);
});

test('mapFireWireIncident tolerates a malformed known_units string', () => {
  const mapped = mapFireWireIncident({ ...ROW, known_units: 'not json' });
  assert.deepEqual(mapped.units, []);
});
