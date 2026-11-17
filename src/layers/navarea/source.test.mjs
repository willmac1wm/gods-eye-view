// src/layers/navarea/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavareaSource } from './source.js';

const SNAPSHOT = {
  fetchedAt: 1,
  stale: false,
  bulletinDate: '131651Z NOV',
  inForceCount: 18,
  warnings: [
    {
      id: 'NAVAREA IV 1097/26',
      number: 1097,
      year: 26,
      area: 'CARIBBEAN SEA.',
      text: 'DERELICT VESSEL',
      positions: [{ lat: 17.05, lon: -61.96 }],
      positionParse: true,
      category: 'wreck',
      issuedAt: '131431Z NOV 26',
    },
  ],
};

test('getSnapshot hits the same-origin proxy and validates the bulletin', async () => {
  const requests = [];
  const source = createNavareaSource({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(SNAPSHOT), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/navarea');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(snapshot.bulletinDate, '131651Z NOV');
  assert.equal(snapshot.inForceCount, 18);
  assert.equal(snapshot.warnings.length, 1);
  assert.equal(snapshot.warnings[0].id, 'NAVAREA IV 1097/26');
});

test('getSnapshot throws on proxy errors and honors abort', async () => {
  const failing = createNavareaSource({
    fetchImpl: async () => new Response('down', { status: 503 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 503/);
  const malformed = createNavareaSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ warnings: 'nope' }), { status: 200 }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed/);
  const aborted = createNavareaSource({
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => aborted.getSnapshot({ signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
