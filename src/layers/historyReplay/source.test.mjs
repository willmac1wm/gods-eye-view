import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistorySource } from './source.js';

const T0 = 1794772800000;
const HOUR = 3600 * 1000;

const statusPayload = {
  aircraftRows: 615374,
  feedRows: 80951,
  oldestMs: T0 - 30 * HOUR,
  newestMs: T0,
};

const aircraftPayload = {
  count: 2,
  fromMs: T0 - HOUR,
  untilMs: T0,
  rows: [
    { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.0, lon: -74.9, alt: 5000, speed: 200, track: 90, seen_at: T0 - 30 * 60_000 },
    { hex: 'a2', kind: 'air', flight: 'N456', lat: 39.1, lon: -74.8, alt: 3000, speed: 150, track: 180, seen_at: T0 - 5 * 60_000 },
  ],
};

const feedPayload = {
  count: 1,
  fromMs: T0 - HOUR,
  untilMs: T0,
  rows: [
    { id: 'f1', source: 'firewire', source_label: 'Fire Wire', cat: 'fire', type: 'DISPATCH', title: 'Structure fire', lat: 39.0, lng: -74.9, pub_ms: T0 - 10 * 60_000 },
  ],
};

function fetchFor(routes) {
  return async (url) => {
    for (const [match, payload] of routes) {
      if (url.startsWith(match)) {
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
  };
}

test('getStatus returns the validated status', async () => {
  const source = createHistorySource({
    fetchImpl: fetchFor([['/api/history/status', statusPayload]]),
  });
  const status = await source.getStatus();
  assert.equal(status.aircraftRows, 615374);
  assert.equal(status.newestMs, T0);
});

test('getWindow fetches aircraft + feed for the window', async () => {
  const seen = [];
  const source = createHistorySource({
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.startsWith('/api/history/aircraft'))
        return { ok: true, status: 200, json: async () => aircraftPayload };
      if (url.startsWith('/api/history/feed'))
        return { ok: true, status: 200, json: async () => feedPayload };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  const window = await source.getWindow({ fromMs: T0 - HOUR, untilMs: T0 });
  assert.equal(window.aircraft.rows.length, 2);
  assert.equal(window.feed.rows.length, 1);
  assert.equal(window.aircraft.rows[0].flight, 'N123');
  assert.equal(window.feed.rows[0].title, 'Structure fire');
  // The aircraft query carries the county bbox; the feed query does not need it.
  assert.match(seen.find((u) => u.startsWith('/api/history/aircraft')), /bbox=38\.9/);
  assert.match(seen.find((u) => u.startsWith('/api/history/aircraft')), /limit=500/);
});

test('getWindow throws on a non-OK status', async () => {
  const source = createHistorySource({
    fetchImpl: fetchFor([]),
  });
  await assert.rejects(
    () => source.getWindow({ fromMs: T0 - HOUR, untilMs: T0 }),
    /History HTTP 404/,
  );
});

test('getWindow throws on a malformed payload', async () => {
  const source = createHistorySource({
    fetchImpl: fetchFor([
      ['/api/history/aircraft', { rows: 'not-an-array' }],
      ['/api/history/feed', feedPayload],
    ]),
  });
  await assert.rejects(
    () => source.getWindow({ fromMs: T0 - HOUR, untilMs: T0 }),
    /Malformed history window/,
  );
});

test('getWindow needs both window bounds', async () => {
  const source = createHistorySource({ fetchImpl: fetchFor([]) });
  await assert.rejects(
    () => source.getWindow({ fromMs: T0 }),
    /needs fromMs and untilMs/,
  );
});
