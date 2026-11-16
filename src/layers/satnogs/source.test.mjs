import assert from 'node:assert/strict';
import test from 'node:test';
import { createSatnogsSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 1_200_000,
  stations: [
    {
      id: 223,
      name: 'W2MMD GCARC Clubhouse',
      lat: 39.716,
      lon: -75.21,
      distanceKm: 84,
      observations: 64276,
      successRate: 67,
      count: 1,
      ok: true,
    },
  ],
  count: 1,
  observations: [
    {
      id: 15449441,
      // Relative to now: the trailing-7-day window in records.js would
      // otherwise age this fixture out of the snapshot a week after it
      // was written.
      start: new Date(Date.now() - 60 * 60_000).toISOString(),
      end: new Date(Date.now() - 50 * 60_000).toISOString(),
      ground_station: 223,
      norad_cat_id: 98194,
      satellite_name: 'CPSAT',
      status: 'good',
      vetted_status: null,
      waterfall:
        'https://s3.eu-central-1.wasabisys.com/satnogs-network/data_obs/2026/11/16/5/15449441/waterfall_15449441_2026-11-16T05-12-41.png',
      payload:
        'https://network-satnogs.freetls.fastly.net/media/data_obs/2026/11/16/5/15449441/satnogs_15449441_2026-11-16T05-12-41.ogg',
      demod_count: 21,
      transmitter_description: 'Mode U - BPSK9k6 - AX.25 G3RUH',
      transmitter_mode: 'BPSK',
      transmitter_downlink_low: 437265000,
      transmitter_downlink_high: 437265000,
      observation_frequency: 437265000,
      max_altitude: 29,
      rise_azimuth: 196,
      set_azimuth: 331,
      station_name: 'W2MMD GCARC Clubhouse',
      station_lat: 39.716,
      station_lng: -75.21,
    },
  ],
};

test('getSnapshot fetches the same-origin proxy and normalizes the rows', async () => {
  const calls = [];
  const source = createSatnogsSource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/satnogs');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].stableId, 'satnogs:15449441');
  assert.equal(snapshot.rows[0].satelliteName, 'CPSAT');
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.scheduledCount, 0);
  assert.equal(snapshot.stationCount, 4);
});

test('getSnapshot throws on HTTP errors and malformed payloads', async () => {
  const failing = createSatnogsSource({
    fetchImpl: async () => new Response('boom', { status: 502 }),
  });
  await assert.rejects(() => failing.getSnapshot(), /SatNOGS HTTP 502/);
  const malformed = createSatnogsSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
  });
  await assert.rejects(
    () => malformed.getSnapshot(),
    /Malformed SatNOGS response/,
  );
  const nonJson = createSatnogsSource({
    fetchImpl: async () => new Response('not json', { status: 200 }),
  });
  await assert.rejects(
    () => nonJson.getSnapshot(),
    /Malformed SatNOGS response/,
  );
});

test('getSnapshot aborts before and after the fetch', async () => {
  const source = createSatnogsSource({
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
