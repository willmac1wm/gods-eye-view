import assert from 'node:assert/strict';
import test from 'node:test';
import {
  spaceWeatherProxy,
  SPACE_WEATHER_FAST_TTL_MS,
} from './spaceWeather.js';

const T0 = 1_793_123_456_789;

// Live SWPC shapes, 2026-11-16 (Kp 0 at 22:27 UTC; forecast max 4.67).
const KP_MINUTE = [
  { time_tag: '2026-11-16T22:26:00Z', kp_index: 0, estimated_kp: 0.0 },
  { time_tag: '2026-11-16T22:27:00Z', kp_index: 0, estimated_kp: 0.0 },
];
const KP_FORECAST = [
  { time_tag: '2026-11-16T21:00:00.000Z', kp: 1.0 },
  { time_tag: '2026-11-17T00:00:00.000Z', kp: 2.33 },
];
const THREE_DAY_TEXT =
  'NOAA Space Weather Prediction Center\n' +
  ':Product: 3-Day Forecast\n' +
  ':Issued: 2026 Nov 16 1230 UTC\n' +
  'A. NOAA Geomagnetic Activity Observation and Forecast\n' +
  'The greatest observed 3 hr Kp over the past 24 hours was 1.\n';
const ACE_SWEPAM = [{ time_tag: '2026-11-16T22:27:00Z', density: 5.1, speed: 380.2 }];
const ACE_MAG = [{ time_tag: '2026-11-16T22:27:00Z', bt: 4.2, bz_gsm: -1.1 }];

function upstreamFor(url) {
  if (url.includes('planetary_k_index_1m.json'))
    return new Response(JSON.stringify(KP_MINUTE), { status: 200 });
  if (url.includes('noaa-planetary-k-index-forecast.json'))
    return new Response(JSON.stringify(KP_FORECAST), { status: 200 });
  if (url.includes('3-day-forecast.txt'))
    return new Response(THREE_DAY_TEXT, { status: 200 });
  if (url.includes('ace_swepam_1h.json'))
    return new Response(JSON.stringify(ACE_SWEPAM), { status: 200 });
  if (url.includes('ace_mag_1h.json'))
    return new Response(JSON.stringify(ACE_MAG), { status: 200 });
  return new Response('not found', { status: 404 });
}

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = spaceWeatherProxy({
    fetchImpl,
    now: clock,
    warn: (...args) => warnings.push(args.join(' ')),
  });
  let handler;
  let mountPath;
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        mountPath = path;
        handler = fn;
      },
    },
  });
  const call = async (url) => {
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        res.status = status;
        res.headers = headers;
        res.headersSent = true;
      },
      end(text) {
        res.body = text;
      },
    };
    await handler({ url }, res);
    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      json: res.body ? JSON.parse(res.body) : null,
    };
  };
  return {
    mountPath,
    call,
    warnings,
    setTime: (ms) => {
      currentTime = ms;
    },
    get time() {
      return currentTime;
    },
  };
}

test('first call fetches all five SWPC products and serves them fresh', async () => {
  const calls = [];
  const m = mount({
    fetchImpl: async (url) => {
      calls.push(url);
      return upstreamFor(url);
    },
  });
  assert.equal(m.mountPath, '/api/space-weather');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.kpMinute.length, 2);
  assert.equal(res.json.kpMinute.at(-1).estimated_kp, 0.0);
  assert.equal(res.json.kpForecast.length, 2);
  assert.match(res.json.threeDayText, /greatest observed 3 hr Kp/);
  assert.equal(res.json.aceSwepam[0].speed, 380.2);
  assert.equal(res.json.aceMag[0].bt, 4.2);
  assert.equal(calls.length, 5);

  const status = await m.call('/status');
  assert.equal(status.json.kp, 0.0);
  assert.equal(status.json.stale, false);
});

test('a second call inside both TTLs is a cache hit (no second fetch)', async () => {
  let calls = 0;
  const m = mount({
    fetchImpl: async (url) => {
      calls += 1;
      return upstreamFor(url);
    },
  });
  await m.call('/');
  await m.call('/');
  assert.equal(calls, 5);
});

test('after the fast TTL, a failing Kp fetch serves the stale cache', async () => {
  let fail = false;
  const m = mount({
    fetchImpl: async (url) =>
      fail ? new Response('boom', { status: 500 }) : upstreamFor(url),
  });
  const fresh = await m.call('/');
  assert.equal(fresh.json.stale, false);
  fail = true;
  m.setTime(T0 + SPACE_WEATHER_FAST_TTL_MS + 1);
  const stale = await m.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.kpMinute.at(-1).estimated_kp, 0.0);
});

test('a cold cache with every product failing answers 502', async () => {
  const m = mount({
    fetchImpl: async () => new Response('boom', { status: 500 }),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
  assert.match(res.json.error, /no cache available/);
});

test('the slow family survives a fast-only failure and vice versa', async () => {
  const m = mount({
    fetchImpl: async (url) => {
      if (url.includes('ace_mag_1h.json'))
        return new Response('boom', { status: 500 });
      return upstreamFor(url);
    },
  });
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.aceMag, null);
  assert.equal(res.json.aceSwepam[0].speed, 380.2);
  assert.equal(res.json.kpMinute.length, 2);
});
