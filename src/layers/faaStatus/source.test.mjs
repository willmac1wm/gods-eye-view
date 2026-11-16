import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaaNasSource } from './source.js';

const payload = {
  fetchedAt: 1,
  stale: false,
  ttlMs: 120000,
  updateTime: 'Mon Nov 16 19:28:03 2026 GMT',
  updateTimeMs: Date.parse('Mon Nov 16 19:28:03 2026 GMT'),
  local: [
    {
      airport: 'ACY',
      category: 'ground-stop',
      reason: 'telecom failure',
      start: null,
      reopen: null,
      endTime: '09:00 pm EST',
      avg: null,
      max: null,
      trend: null,
      delayType: null,
      startMs: null,
      reopenMs: null,
    },
  ],
  nationwide: {
    groundStop: 12,
    groundDelay: 4,
    closure: 5,
    arrivalDepartureDelay: 2,
  },
  totalAirports: 21,
};

function stubFetch(body, status = 200) {
  return async (url) => {
    assert.equal(url, '/api/faa-status');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

test('snapshot carries local events, nationwide counts and feed freshness', async () => {
  const source = createFaaNasSource({
    fetchImpl: stubFetch(payload),
    now: () => Date.parse('Mon Nov 16 19:30:00 2026 GMT'),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.local.length, 1);
  assert.equal(snapshot.local[0].airport, 'ACY');
  assert.equal(snapshot.local[0].category, 'ground-stop');
  assert.equal(snapshot.nationwide.groundStop, 12);
  assert.equal(snapshot.totalAirports, 21);
  assert.equal(snapshot.updateStale, false);
  assert.equal(snapshot.stale, false);
});

test('a quiet feed is an empty local list, not an error', async () => {
  const source = createFaaNasSource({
    fetchImpl: stubFetch({ ...payload, local: [], totalAirports: 8 }),
    now: () => Date.parse('Mon Nov 16 19:30:00 2026 GMT'),
  });
  const snapshot = await source.getSnapshot({});
  assert.deepEqual(snapshot.local, []);
  assert.equal(snapshot.nationwide.groundStop, 12);
});

test('an Update_Time older than 15 minutes flags the feed stalled', async () => {
  const source = createFaaNasSource({
    fetchImpl: stubFetch(payload),
    now: () => Date.parse('Mon Nov 16 20:00:00 2026 GMT'),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.updateStale, true);
});

test('a malformed proxy payload throws instead of half-rendering', async () => {
  const source = createFaaNasSource({
    fetchImpl: stubFetch({ ...payload, local: 'nope' }),
  });
  await assert.rejects(() => source.getSnapshot({}), /Malformed/);
});

test('a proxy 502 throws with the status', async () => {
  const source = createFaaNasSource({
    fetchImpl: stubFetch({ error: 'FAA fetch failed' }, 502),
  });
  await assert.rejects(() => source.getSnapshot({}), /FAA status HTTP 502/);
});
