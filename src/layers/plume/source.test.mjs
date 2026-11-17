// src/layers/plume/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFalloutPlumeSource } from './source.js';

// Verbatim live NWS hourly periods from 2026-11-17 (PHI/40,55).
const payload = {
  properties: {
    periods: [
      {
        startTime: '2026-11-17T07:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
      {
        startTime: '2026-11-17T08:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
      {
        startTime: '2026-11-17T09:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
    ],
  },
};

test('getSnapshot fetches the NWS release-cell forecast direct and steps the plume', async () => {
  const calls = [];
  const source = createFalloutPlumeSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.weather.gov/gridpoints/PHI/40,55/forecast/hourly?units=us',
  );
  assert.equal(snapshot.release.name, 'Salem/Hope Creek');
  assert.equal(snapshot.release.lat, 39.46278);
  assert.equal(snapshot.release.lon, -75.53556);
  assert.equal(snapshot.counts.winds, 3);
  assert.equal(snapshot.counts.nodes, 4);
  assert.equal(snapshot.distanceMi, 15);
  assert.equal(snapshot.stoppedEarly, false);
  assert.equal(snapshot.cone.length, 7);
  assert.equal(snapshot.epz.length, 65);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createFalloutPlumeSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /Fallout plume HTTP 502/);
  const malformed = createFalloutPlumeSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed fallout plume response/,
  );
  const empty = createFalloutPlumeSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ properties: { periods: [] } }), {
        status: 200,
      }),
  });
  await assert.rejects(
    () => empty.getSnapshot(),
    /Malformed fallout plume response/,
  );
  const nonJson = createFalloutPlumeSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed fallout plume response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createFalloutPlumeSource({
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
