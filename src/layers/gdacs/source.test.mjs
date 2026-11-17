// src/layers/gdacs/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGdacsSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 900_000,
  count: 1,
  events: [
    {
      title:
        'Green earthquake (Magnitude 6.6M, Depth:68km) in Indonesia 16/11/2026 21:11 UTC, 6 thousand in MMI V.',
      link: 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
      pubDate: 'Mon, 16 Nov 2026 21:26:52 GMT',
      fromDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
      toDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
      eventType: 'EQ',
      alertLevel: 'Green',
      alertScore: '0',
      eventId: '1577696',
      country: 'Indonesia',
      iso3: 'IDN',
      lat: '-6.0804',
      lon: '131.4868',
      severity: {
        text: 'Magnitude 6.6M, Depth:68km',
        unit: 'M',
        value: '6.6',
      },
      population: { text: '6 thousand in MMI V', unit: 'in MMI V', value: '6100' },
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the events', async () => {
  const calls = [];
  const source = createGdacsSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/gdacs');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.events[0].id, 'EQ1577696');
  assert.equal(snapshot.events[0].country, 'Indonesia');
  assert.equal(snapshot.events[0].severity.value, 6.6);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createGdacsSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /GDACS HTTP 502/);
  const malformed = createGdacsSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed GDACS response/,
  );
  const nonJson = createGdacsSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed GDACS response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createGdacsSource({
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
