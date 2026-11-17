import assert from 'node:assert/strict';
import test from 'node:test';
import { createVdl2Source } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  heardLocal: 100,
  heardTruncated: true,
  stationFlagged: true,
  stationFlagReason: 'Rate anomaly detected',
  rows: [
    {
      id: '8135359152',
      stableId: 'vdl2:8135359152',
      flight: 'MX501',
      tail: 'N219BZ',
      fromHex: 'A12345',
      label: 'H1',
      mode: '2',
      frequency: 136.65,
      stationIdent: 'PhillyRox-VDLM',
      stationAirport: 'KPHL',
      category: 'mayday',
      severity: 'critical',
      undecoded: false,
      hasPosition: true,
      lat: 39.5,
      lon: -74.9,
      timeMs: 1_793_123_456_000,
      url: 'https://api.airframes.io/v1/messages/8135359152',
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the rows', async () => {
  const calls = [];
  const source = createVdl2Source({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/vdl2');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].stableId, 'vdl2:8135359152');
  assert.equal(snapshot.rows[0].category, 'mayday');
  assert.equal(snapshot.categorizedCount, 1);
  assert.equal(snapshot.undecodedCount, 0);
  assert.equal(snapshot.heardLocal, 100);
  assert.equal(snapshot.heardTruncated, true);
  assert.equal(snapshot.stationFlagged, true);
  assert.equal(snapshot.stationFlagReason, 'Rate anomaly detected');
  assert.equal(snapshot.fetchedAt, 1_793_123_456_789);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createVdl2Source({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /VDL2 HTTP 502/);
  const malformed = createVdl2Source({
    fetchImpl: async () =>
      new Response(JSON.stringify({ rows: 'nope' }), { status: 200 }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed VDL2 response/);
});

test('getSnapshot honours an abort signal', async () => {
  const source = createVdl2Source({
    fetchImpl: async () =>
      new Response(JSON.stringify(payload), { status: 200 }),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
