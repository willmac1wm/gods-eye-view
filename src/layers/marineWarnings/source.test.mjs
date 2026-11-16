import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarineWarningsSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 900_000,
  sources: [
    { feed: 'sector-delaware-bay', count: 1, ok: true },
    { feed: 'district-5', count: 0, ok: true },
  ],
  count: 1,
  items: [
    {
      feed: 'sector-delaware-bay',
      guid: '70438165',
      title: 'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
      link: 'https://content.govdelivery.com/accounts/USDHSCG/bulletins/432cd15',
      pubDate: 'Sat, 14 Nov 2026 04:24:32 -0600',
      description:
        '<p>1. LISTON RANGE FRONT LIGHT (LLNR 2445) REPORTED WITH A LOW INTENSITY LIGHT.<br />CANCEL AT//220000Z NOV 26//</p> <p>BT</p>',
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the rows', async () => {
  const calls = [];
  const source = createMarineWarningsSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/marine-warnings');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].stableId, 'SEC SDB:0288-26');
  assert.equal(snapshot.rows[0].llnr, '2445');
  assert.equal(snapshot.rows[0].hasPosition, false);
  assert.equal(snapshot.pinnedCount, 0);
  assert.equal(snapshot.listOnlyCount, 1);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createMarineWarningsSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /Marine warnings HTTP 502/);
  const malformed = createMarineWarningsSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed marine warnings response/,
  );
  const nonJson = createMarineWarningsSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed marine warnings response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createMarineWarningsSource({
    fetchImpl: async (_url, { signal } = {}) => {
      signal?.throwIfAborted();
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
