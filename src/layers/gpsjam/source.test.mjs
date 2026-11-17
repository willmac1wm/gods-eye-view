import assert from 'node:assert/strict';
import test from 'node:test';
import { createGpsjamSource } from './source.js';

const boundary = [
  [-74.655086, 39.503507],
  [-74.958634, 39.450412],
  [-75.047572, 39.234937],
  [-74.835067, 39.073298],
  [-74.533806, 39.125839],
  [-74.442775, 39.340569],
];

const payload = {
  date: '2026-11-15',
  source: 'merged',
  suspect: false,
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 21_600_000,
  worldRows: 48208,
  count: 1,
  cells: [
    {
      hex: '842aad9ffffffff',
      lat: 39.288,
      lon: -74.745,
      boundary,
      good: 726,
      bad: 0,
      total: 726,
      percent: 0,
      level: 'low',
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the cells', async () => {
  const calls = [];
  const source = createGpsjamSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/gpsjam');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.date, '2026-11-15');
  assert.equal(snapshot.source, 'merged');
  assert.equal(snapshot.suspect, false);
  assert.equal(snapshot.cells.length, 1);
  assert.equal(snapshot.cells[0].hex, '842aad9ffffffff');
  assert.equal(snapshot.cells[0].total, 726);
  assert.equal(snapshot.cells[0].level, 'low');
  assert.equal(snapshot.totalAircraft, 726);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createGpsjamSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /GPSJam HTTP 502/);
  const malformed = createGpsjamSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ date: 'yesterday' }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed GPSJam response/,
  );
});

test('getSnapshot honours an abort signal', async () => {
  const source = createGpsjamSource({
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
