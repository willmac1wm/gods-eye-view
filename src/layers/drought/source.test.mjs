import assert from 'node:assert/strict';
import test from 'node:test';
import { createDroughtSource } from './source.js';

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

test('getSnapshot returns the county category with its release date', async () => {
  const source = createDroughtSource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/drought');
      return okResponse({
        fetchedAt: 1,
        releasedAt: 'Thu, 12 Nov 2026 11:15:51 GMT',
        stale: false,
        category: 0,
        categories: [{ point: { lat: 39.08, lon: -74.9 }, category: 0 }],
      });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.category, 0);
  assert.equal(snapshot.releasedAt, 'Thu, 12 Nov 2026 11:15:51 GMT');
  assert.equal(snapshot.stale, false);
});

test('getSnapshot accepts a no-drought county (null category)', async () => {
  const source = createDroughtSource({
    fetchImpl: async () =>
      okResponse({
        fetchedAt: 1,
        releasedAt: 'Thu, 12 Nov 2026 11:15:51 GMT',
        stale: false,
        category: null,
        categories: [],
      }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.category, null);
});

test('getSnapshot throws on HTTP failure and on a malformed payload', async () => {
  const failing = createDroughtSource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 502/);
  const malformed = createDroughtSource({
    fetchImpl: async () => okResponse({ category: 0 }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed/);
});
