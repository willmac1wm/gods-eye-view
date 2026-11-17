import assert from 'node:assert/strict';
import test from 'node:test';
import { createRadiationSource } from './source.js';

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function payload() {
  return {
    fetchedAt: 1,
    stale: false,
    monitors: [
      {
        key: 'philadelphia',
        name: 'Philadelphia',
        state: 'PA',
        doseRateNSvH: 41,
        gammaCpmR02: 1438,
        sampleTime: '2026-11-16T21:39:00.000Z',
        distanceKm: 101,
      },
      {
        key: 'edison',
        name: 'Edison',
        state: 'NJ',
        doseRateNSvH: 39,
        gammaCpmR02: 1348,
        sampleTime: '2026-11-16T21:42:00.000Z',
        distanceKm: 163,
      },
    ],
    safecast: {
      value: 26,
      unit: 'cpm',
      latitude: 38.808321666666664,
      longitude: -76.97334833333333,
      captured_at: '2017-06-06T20:22:57.000Z',
    },
  };
}

test('getSnapshot returns both monitors with the Safecast supplement', async () => {
  const source = createRadiationSource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/radiation');
      return okResponse(payload());
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.monitors.length, 2);
  assert.equal(snapshot.monitors[0].name, 'Philadelphia');
  assert.equal(snapshot.monitors[0].doseRateNSvH, 41);
  assert.equal(snapshot.monitors[1].doseRateNSvH, 39);
  assert.equal(snapshot.safecast.value, 26);
  assert.equal(snapshot.safecast.unit, 'cpm');
});

test('getSnapshot tolerates a missing Safecast half', async () => {
  const source = createRadiationSource({
    fetchImpl: async () => okResponse({ ...payload(), safecast: null }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.safecast, null);
});

test('getSnapshot throws on HTTP failure and on an empty monitor list', async () => {
  const failing = createRadiationSource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 502/);
  const empty = createRadiationSource({
    fetchImpl: async () => okResponse({ fetchedAt: 1, stale: false, monitors: [] }),
  });
  await assert.rejects(() => empty.getSnapshot(), /invalid snapshot/);
});
