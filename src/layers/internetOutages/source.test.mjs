// src/layers/internetOutages/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInternetOutagesSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 300_000,
  window: { summaryFrom: 1_793_121_296_789, alertsFrom: 1_793_037_056_789, until: 1_793_123_456_789 },
  sources: {
    usSummary: { ok: true, count: 0 },
    njSummary: { ok: true, count: 0 },
    alerts: { ok: true, count: 1 },
  },
  usSummary: [],
  njSummary: [],
  alerts: [
    {
      datasource: 'bgp',
      entity: { code: '7821', name: 'AS7821 (ZAYO-MN)', type: 'asn' },
      time: 1794822000,
      level: 'critical',
      condition: '< 0.99',
      value: 0,
      historyValue: 37,
      method: 'median',
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the rows', async () => {
  const calls = [];
  const source = createInternetOutagesSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/internet-outages');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.counts.alerts, 1);
  assert.equal(snapshot.counts.criticalAlerts, 1);
  assert.equal(snapshot.alerts[0].entityCode, '7821');
  assert.equal(snapshot.alerts[0].valueRatio, 0);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createInternetOutagesSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(
    () => failing.getSnapshot(),
    /Internet outages HTTP 502/,
  );
  const malformed = createInternetOutagesSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed internet outages response/,
  );
  const nonJson = createInternetOutagesSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed internet outages response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createInternetOutagesSource({
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
