import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchFireWireIncidents, mapFireWireIncident } from './firewireCad.js';
import { classifyCall, firewireBases } from './scanner.js';

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
  assert.equal(
    mapped.summary,
    'One thirty four seventy five, Medevac, correct, thank you.',
  );
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

test('firewireBases and fetchFireWireIncidents fall back to :8000 when FIREWIRE_URL points at :8100', async () => {
  const bases = firewireBases({ FIREWIRE_URL: 'http://127.0.0.1:8100' });
  assert.deepEqual(bases, ['http://127.0.0.1:8100', 'http://127.0.0.1:8000']);

  const saved = process.env.FIREWIRE_URL;
  process.env.FIREWIRE_URL = 'http://127.0.0.1:8100';
  const calls = [];
  try {
    const res = await fetchFireWireIncidents({
      fetchImpl: async (url) => {
        calls.push(url);
        if (String(url).startsWith('http://127.0.0.1:8100')) {
          return new Response('{"detail":"Not Found"}', { status: 404 });
        }
        return new Response(JSON.stringify([ROW]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    assert.equal(res.configured, true);
    assert.equal(res.incidents.length, 1);
    assert.deepEqual(calls, [
      'http://127.0.0.1:8100/api/incidents?limit=50',
      'http://127.0.0.1:8000/api/incidents?limit=50',
    ]);

    // Also falls back when baseUrl is explicitly passed by firewireCadProxy
    calls.length = 0;
    const resExplicit = await fetchFireWireIncidents({
      baseUrl: 'http://127.0.0.1:8100',
      fetchImpl: async (url) => {
        calls.push(url);
        if (String(url).startsWith('http://127.0.0.1:8100')) {
          return new Response('{"detail":"Not Found"}', { status: 404 });
        }
        return new Response(JSON.stringify([ROW]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    assert.equal(resExplicit.incidents.length, 1);
    assert.deepEqual(calls, [
      'http://127.0.0.1:8100/api/incidents?limit=50',
      'http://127.0.0.1:8000/api/incidents?limit=50',
    ]);
  } finally {
    if (saved === undefined) delete process.env.FIREWIRE_URL;
    else process.env.FIREWIRE_URL = saved;
  }
});

test('classifyCall surfaces USCG SAR and Medevac operations as public-safety while keeping routine ATC in aviation', () => {
  assert.equal(
    classifyCall(
      {
        incident_type: 'USCG Air Station SAR Operation',
        location: 'KACY Tower (120.3) Airspace',
      },
      'kacy_1795174786.mp3',
    ),
    'public-safety',
  );
  assert.equal(
    classifyCall(
      {
        incident_type: 'Medevac Flight Operation',
        location: 'KACY Approach/Departure (124.6) Airspace',
      },
      'kacy_1795116436.mp3',
    ),
    'public-safety',
  );
  assert.equal(
    classifyCall(
      {
        incident_type: 'ATC Radio Transmission',
        location: 'KACY Runway Three One',
      },
      'kacy_1795055585.mp3',
    ),
    'aviation',
  );
});
