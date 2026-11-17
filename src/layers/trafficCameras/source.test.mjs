import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrafficCamerasSource } from './source.js';

const NJ511_ROW = {
  name: 'NJ 47 @ County Rd 610',
  image_url: 'https://511nj.org/api/camera/123/image',
  road: 'NJ 47',
  lat: 39.0827,
  lng: -74.82,
  heading: null,
  fov: 60,
  heading_confidence: 'estimated',
  source: '511NJ',
  extra: { id: 123 },
};

const DELDOT_ROW = {
  name: 'Cape May Ferry Terminal',
  image_url: 'https://example.invalid/ferry.jpg',
  road: 'Ferry Terminal',
  lat: 38.9336,
  lng: -74.9608,
  heading: null,
  fov: 60,
  heading_confidence: 'high',
  source: 'DRBA',
  extra: { city: 'Cape May' },
};

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

test('getSnapshot merges both halves when both providers answer', async () => {
  const seen = [];
  const source = createTrafficCamerasSource({
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === '/api/nj511')
        return okResponse({ configured: true, cameras: [NJ511_ROW], error: null });
      return okResponse({ cameras: [DELDOT_ROW], error: null });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.deepEqual([...seen].sort(), ['/api/deldot-cameras', '/api/nj511']);
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.nj511Configured, true);
  assert.equal(snapshot.nj511Count, 1);
  assert.equal(snapshot.deldotCount, 1);
  assert.equal(snapshot.stale, false);
});

test('getSnapshot degrades to DelDOT-only when NJ511 is unconfigured', async () => {
  const source = createTrafficCamerasSource({
    fetchImpl: async (url) => {
      if (url === '/api/nj511')
        return okResponse({ configured: false, cameras: [], error: null });
      return okResponse({ cameras: [DELDOT_ROW], error: null });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.nj511Configured, false);
  assert.equal(snapshot.nj511Count, 0);
});

test('getSnapshot survives one half failing and throws when both fail', async () => {
  const oneDown = createTrafficCamerasSource({
    fetchImpl: async (url) => {
      if (url === '/api/nj511')
        return { ok: false, status: 502, json: async () => ({}) };
      return okResponse({ cameras: [DELDOT_ROW], error: null });
    },
  });
  const snapshot = await oneDown.getSnapshot();
  assert.equal(snapshot.records.length, 1);
  assert.match(snapshot.nj511Error, /502/);

  const bothDown = createTrafficCamerasSource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => bothDown.getSnapshot(), /unavailable/);
});
