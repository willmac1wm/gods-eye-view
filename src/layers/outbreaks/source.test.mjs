// src/layers/outbreaks/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutbreaksSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 86_400_000,
  arbonet: {
    ok: true,
    asOf: 'November 10, 2026',
    status: 'preliminary',
    states: [{ state: 'NJ', cases: 35, band: '>25' }],
    njCounties: [
      {
        fips: '34009',
        activity: 'Non-human activity',
        humanCases: 0,
        neuroinvasive: 0,
        donors: 0,
      },
    ],
  },
  don: {
    ok: true,
    items: [
      {
        id: 'DON626',
        title: 'Middle East respiratory syndrome (MERS) – Qatar',
        date: '13 November 2026',
        dateIso: '2026-11-13T00:00:00.000Z',
        url: 'https://www.who.int/2026-DON626',
      },
    ],
  },
};

test('getSnapshot fetches the same-origin proxy and normalizes the halves', async () => {
  const calls = [];
  const source = createOutbreaksSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/outbreaks');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.counts.njCases, 35);
  assert.equal(snapshot.counts.capeMayHumanCases, 0);
  assert.equal(snapshot.capeMay.county, 'Cape May');
  assert.equal(snapshot.counts.don, 1);
  assert.equal(snapshot.don.items[0].id, 'DON626');
  assert.equal(snapshot.arbonet.asOf, 'November 10, 2026');
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createOutbreaksSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /Outbreaks HTTP 502/);
  const malformed = createOutbreaksSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed outbreaks response/,
  );
  const nonJson = createOutbreaksSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed outbreaks response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createOutbreaksSource({
    fetchImpl: async () =>
      new Response(JSON.stringify(payload), { status: 200 }),
  });
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: before.signal }),
    /aborted/i,
  );
  const during = new AbortController();
  const pending = source.getSnapshot({ signal: during.signal });
  during.abort();
  await assert.rejects(pending, /aborted/i);
});
