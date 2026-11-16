import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAprsWeatherSource,
  AprsKeyMissingError,
} from './source.js';

const NOW = Date.now();

function payload(stations) {
  return {
    fetchedAt: NOW,
    stale: false,
    ttlMs: 300000,
    count: stations.length,
    stations,
  };
}

function station(callsign, overrides = {}) {
  return {
    callsign,
    place: 'Somewhere',
    lat: 39.1,
    lon: -74.8,
    timeMs: NOW - 60_000,
    tempC: 3,
    humidity: 75,
    pressureMb: 1025.2,
    windDirDeg: 24,
    windSpeedMps: 0,
    windGustMps: 1.8,
    rain1hMm: 0,
    rain24hMm: 0,
    rainMnMm: 0,
    luminosity: null,
    ...overrides,
  };
}

const ALL_STATIONS = payload([
  station('KC2DUX'),
  station('DW8913'),
  station('FW2611'),
  station('K2GFM'),
  station('CW8812'),
  station('FW6400'),
]);

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { fetchImpl, calls };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test('OK 200 returns normalized rows', async () => {
  const { fetchImpl, calls } = stubFetch(async () => json(ALL_STATIONS));
  const source = createAprsWeatherSource({ fetchImpl });
  const rows = await source.getSnapshot();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/aprs');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(rows.length, 6);
  assert.equal(rows[0].callsign, 'KC2DUX');
  assert.equal(rows[0].tempF, 37.4);
});

test('HTTP 500 throws APRS HTTP 500', async () => {
  const { fetchImpl } = stubFetch(async () => json({ error: 'boom' }, 500));
  const source = createAprsWeatherSource({ fetchImpl });
  await assert.rejects(() => source.getSnapshot(), /APRS HTTP 500/);
});

test('503 no_key throws the typed key-missing error', async () => {
  const { fetchImpl } = stubFetch(async () => json({ error: 'no_key' }, 503));
  const source = createAprsWeatherSource({ fetchImpl });
  await assert.rejects(
    () => source.getSnapshot(),
    (error) =>
      error instanceof AprsKeyMissingError &&
      error.code === 'no_key' &&
      /key not configured/.test(error.message),
  );
});

test('503 without no_key is a plain HTTP error', async () => {
  const { fetchImpl } = stubFetch(async () =>
    json({ error: 'unavailable' }, 503),
  );
  const source = createAprsWeatherSource({ fetchImpl });
  await assert.rejects(() => source.getSnapshot(), /APRS HTTP 503/);
});

test('malformed JSON body and malformed snapshot throw', async () => {
  const badJson = stubFetch(
    async () => new Response('not json {', { status: 200 }),
  );
  await assert.rejects(
    () => createAprsWeatherSource({ fetchImpl: badJson.fetchImpl }).getSnapshot(),
    /Malformed aprs\.fi response/,
  );

  const badShape = stubFetch(async () => json({ stations: 'nope' }));
  await assert.rejects(
    () =>
      createAprsWeatherSource({ fetchImpl: badShape.fetchImpl }).getSnapshot(),
    /Malformed aprs\.fi response/,
  );
});

test('abort signal is respected', async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetchImpl } = stubFetch(async () => json(ALL_STATIONS));
  const source = createAprsWeatherSource({ fetchImpl });
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});

test('an in-flight request aborted mid-fetch rejects', async () => {
  const controller = new AbortController();
  const { fetchImpl } = stubFetch(async (_url, options) => {
    options.signal.addEventListener('abort', () => {
      // The stub fetch rejects like a real aborted fetch.
    });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
    });
  });
  const source = createAprsWeatherSource({ fetchImpl });
  const pending = source.getSnapshot({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});
