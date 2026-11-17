import assert from 'node:assert/strict';
import test from 'node:test';
import { radiationProxy, RADIATION_PROXY_TTL_MS } from './radiation.js';

const T0 = 1_793_123_456_789;

function radnetCsv(location, time, dose, r02) {
  return (
    'LOCATION_NAME,SAMPLE COLLECTION TIME,DOSE EQUIVALENT RATE (nSv/h),' +
    'GAMMA COUNT RATE R02 (CPM),GAMMA COUNT RATE R03 (CPM),GAMMA COUNT RATE R04 (CPM),' +
    'GAMMA COUNT RATE R05 (CPM),GAMMA COUNT RATE R06 (CPM),GAMMA COUNT RATE R07 (CPM),' +
    'GAMMA COUNT RATE R08 (CPM),GAMMA COUNT RATE R09 (CPM),STATUS\n' +
    `${location},01/01/2026 00:32:00,40.00,1480.00,781.00,233.00,119.00,81.00,101.00,55.00,28.00,APPROVED\n` +
    `${location},${time},${dose}.00,${r02}.00,732.00,220.00,116.00,77.00,92.00,61.00,28.00,APPROVED\n`
  );
}

// Live RadNet rows, 2026-11-16: Philadelphia 41 nSv/h at 21:39 UTC,
// Edison 39 nSv/h at 21:42 UTC. Safecast's nearest row is a 2017
// Maryland measurement (26 cpm) — a supplement, never the headline.
const SAFECAST_ROWS = [
  {
    id: 86772796,
    value: 26.0,
    unit: 'cpm',
    latitude: 38.808321666666664,
    longitude: -76.97334833333333,
    captured_at: '2017-06-06T20:22:57.000Z',
  },
];

function upstreamFor(url) {
  if (url.includes('safecast.org'))
    return new Response(JSON.stringify(SAFECAST_ROWS), { status: 200 });
  if (url.includes('/pa/philadelphia'))
    return new Response(
      radnetCsv('PA: PHILADELPHIA', '11/16/2026 21:39:00', 41, 1438),
      { status: 200 },
    );
  if (url.includes('/nj/edison'))
    return new Response(
      radnetCsv('NJ: EDISON', '11/16/2026 21:42:00', 39, 1348),
      { status: 200 },
    );
  return new Response('not found', { status: 404 });
}

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = radiationProxy({
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

test('first call fetches both RadNet CSVs + Safecast and serves nearest-first', async () => {
  const calls = [];
  const m = mount({
    fetchImpl: async (url) => {
      calls.push(url);
      return upstreamFor(url);
    },
  });
  assert.equal(m.mountPath, '/api/radiation');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, RADIATION_PROXY_TTL_MS);
  assert.equal(res.json.monitors.length, 2);
  assert.equal(res.json.monitors[0].name, 'Philadelphia');
  assert.equal(res.json.monitors[0].doseRateNSvH, 41);
  assert.equal(res.json.monitors[0].gammaCpmR02, 1438);
  assert.equal(res.json.monitors[0].sampleTime, '2026-11-16T21:39:00.000Z');
  assert.ok(res.json.monitors[0].distanceKm < res.json.monitors[1].distanceKm);
  assert.equal(res.json.monitors[1].name, 'Edison');
  assert.equal(res.json.monitors[1].doseRateNSvH, 39);
  assert.equal(res.json.safecast.value, 26);
  assert.equal(res.json.safecast.unit, 'cpm');
  assert.equal(calls.length, 3);
  assert.ok(calls.some((url) => url.includes('distance=200000')));

  const status = await m.call('/status');
  assert.deepEqual(status.json.monitors, [
    'Philadelphia 41 nSv/h',
    'Edison 39 nSv/h',
  ]);
});

test('one monitor failing still serves the other', async () => {
  const m = mount({
    fetchImpl: async (url) => {
      if (url.includes('/pa/philadelphia'))
        return new Response('boom', { status: 500 });
      return upstreamFor(url);
    },
  });
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.monitors.length, 1);
  assert.equal(res.json.monitors[0].name, 'Edison');
});

test('a second call inside the TTL is a cache hit (no second fetch)', async () => {
  let calls = 0;
  const m = mount({
    fetchImpl: async (url) => {
      calls += 1;
      return upstreamFor(url);
    },
  });
  await m.call('/');
  await m.call('/');
  assert.equal(calls, 3);
});

test('after the TTL, failing RadNet fetches serve the stale cache', async () => {
  let fail = false;
  const m = mount({
    fetchImpl: async (url) =>
      fail ? new Response('boom', { status: 500 }) : upstreamFor(url),
  });
  const fresh = await m.call('/');
  assert.equal(fresh.json.stale, false);
  fail = true;
  m.setTime(T0 + RADIATION_PROXY_TTL_MS + 1);
  const stale = await m.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.monitors[0].doseRateNSvH, 41);
  assert.match(m.warnings.join(' '), /refresh failed/);
});

test('a cold cache with both monitors failing answers 502', async () => {
  const m = mount({
    fetchImpl: async () => new Response('boom', { status: 500 }),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
  assert.match(res.json.error, /no cache available/);
});
