import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aprsProxy,
  aprsUpstreamUrl,
  buildAprsProxyStations,
  APRS_PROXY_TTL_MS,
  APRS_PROXY_USER_AGENT,
} from './aprs.js';

// Obviously fake key used only to prove the proxy never leaks it.
const FAKE_KEY = 'test-key-not-real';
const T0 = 1_793_123_456_789;

// Verbatim-shaped aprs.fi `what=wx` success payload (metric, Unix seconds).
function upstreamWx(entries) {
  return {
    command: 'get',
    result: 'ok',
    found: String(entries.length),
    entries,
  };
}

function wxEntry(name, overrides = {}) {
  return {
    name,
    time: Math.floor(T0 / 1000) - 60,
    temp: 3,
    pressure: 1025.2,
    humidity: 75,
    wind_direction: 24,
    wind_speed: 0,
    wind_gust: 1.8,
    rain_1h: 0,
    rain_24h: 0,
    rain_mn: 0,
    luminosity: null,
    ...overrides,
  };
}

const ALL_UPSTREAM = upstreamWx([
  wxEntry('KC2DUX'),
  wxEntry('DW8913'),
  wxEntry('FW2611'),
  wxEntry('K2GFM'),
  wxEntry('CW8812'),
  wxEntry('FW6400'),
]);

function mount({ fetchImpl, env = {} } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = aprsProxy({
    fetchImpl,
    now: clock,
    env,
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

function stubUpstream(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { fetchImpl, calls };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });

test('upstream URL batches all six stations with what=wx and format=json', () => {
  const url = new URL(aprsUpstreamUrl(FAKE_KEY));
  assert.equal(url.origin + url.pathname, 'https://api.aprs.fi/api/get');
  assert.equal(
    url.searchParams.get('name'),
    'KC2DUX,DW8913,FW2611,K2GFM,CW8812,FW6400',
  );
  assert.equal(url.searchParams.get('what'), 'wx');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('apikey'), FAKE_KEY);
  assert.equal(
    APRS_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('station rows carry registry place/coords and mark absent stations missing', () => {
  const rows = buildAprsProxyStations([
    wxEntry('KC2DUX', { time: 1793123400 }),
  ]);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].callsign, 'KC2DUX');
  assert.equal(rows[0].place, 'Eldora, Dennis Twp');
  assert.equal(rows[0].timeMs, 1793123400000);
  assert.equal(rows[0].tempC, 3);
  assert.equal(rows[0].missing, false);
  assert.equal(rows[1].callsign, 'DW8913');
  assert.equal(rows[1].missing, true);
  assert.equal(rows[1].timeMs, null);
  assert.equal(rows[1].tempC, null);
  // Entries outside the registry are ignored, never passed through.
  assert.equal(
    buildAprsProxyStations([wxEntry('KC2DUX'), wxEntry('NOTAREAL')]).length,
    6,
  );
});

test('no key → 503 no_key, status hasKey false, upstream never called', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => json(ALL_UPSTREAM));
  const { mountPath, call } = mount({ fetchImpl, env: {} });
  assert.equal(mountPath, '/api/aprs');

  const res = await call('/');
  assert.equal(res.status, 503);
  assert.deepEqual(res.json, { error: 'no_key' });
  assert.equal(calls.length, 0);

  const status = await call('/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, {
    hasKey: false,
    lastFetch: null,
    count: null,
    stale: false,
    ttlMs: APRS_PROXY_TTL_MS,
  });
  assert.equal(calls.length, 0);
});

test('with key → exactly one batched upstream call, key never in the response', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => json(ALL_UPSTREAM));
  const { call } = mount({ fetchImpl, env: { APRSFI_API_KEY: FAKE_KEY } });

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, APRS_PROXY_TTL_MS);
  assert.equal(res.json.count, 6);
  assert.equal(res.json.stations.length, 6);
  assert.equal(res.json.stations[0].callsign, 'KC2DUX');
  assert.equal(res.json.stations[0].tempC, 3);
  assert.ok(!res.body.includes(FAKE_KEY), 'key leaked into the response');

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('name').split(',').length, 6);
  assert.equal(calls[0].options.headers['User-Agent'], APRS_PROXY_USER_AGENT);
  assert.equal(calls[0].options.headers.Accept, 'application/json');

  const status = await call('/status');
  assert.deepEqual(status.json, {
    hasKey: true,
    lastFetch: T0,
    count: 6,
    stale: false,
    ttlMs: APRS_PROXY_TTL_MS,
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => json(ALL_UPSTREAM));
  const proxy = mount({ fetchImpl, env: { APRSFI_API_KEY: FAKE_KEY } });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + APRS_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 2);
});

test('concurrent requests share one upstream call (single-flight)', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { fetchImpl, calls } = stubUpstream(async () => {
    await gate;
    return json(ALL_UPSTREAM);
  });
  const { call } = mount({ fetchImpl, env: { APRSFI_API_KEY: FAKE_KEY } });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  // Let all three requests reach the in-flight refresh before releasing.
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 1);
});

test('upstream 500 with warm cache serves stale; with cold cache → 502', async () => {
  // The fetch succeeds once (warming the cache) then fails.
  let n = 0;
  const flaky = stubUpstream(async () => {
    n += 1;
    return n === 1 ? json(ALL_UPSTREAM) : json({ error: 'down' }, 500);
  });
  const proxy = mount({
    fetchImpl: flaky.fetchImpl,
    env: { APRSFI_API_KEY: FAKE_KEY },
  });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + APRS_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.count, 6);
  assert.equal(flaky.calls.length, 2);

  // Cold cache + upstream down → 502, and backoff blocks an immediate retry.
  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({
    fetchImpl: failing.fetchImpl,
    env: { APRSFI_API_KEY: FAKE_KEY },
  });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'aprs.fi fetch failed and no cache available');
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 1);
});

test('upstream result:fail → 502 with the description, key never echoed', async () => {
  const { fetchImpl, calls } = stubUpstream(async () =>
    json({
      command: 'get',
      result: 'fail',
      code: 'apikey-invalid',
      description: 'invalid API key',
    }),
  );
  const proxy = mount({ fetchImpl, env: { APRSFI_API_KEY: FAKE_KEY } });
  const res = await proxy.call('/');
  assert.equal(res.status, 502);
  assert.match(res.body, /invalid API key/);
  assert.ok(!res.body.includes(FAKE_KEY), 'key leaked into the error');
  assert.equal(calls.length, 1);
  assert.ok(
    proxy.warnings.every((warning) => !warning.includes(FAKE_KEY)),
    'key leaked into a log line',
  );
});

test('backoff expires: a retry after the cooldown reaches upstream again', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n === 1 ? json({ error: 'down' }, 500) : json(ALL_UPSTREAM);
  });
  const proxy = mount({ fetchImpl, env: { APRSFI_API_KEY: FAKE_KEY } });
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  // Still inside the 15 s backoff: no second upstream call.
  proxy.setTime(T0 + 10_000);
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  // Past the backoff: the retry succeeds and the cache warms.
  proxy.setTime(T0 + 16_000);
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(calls.length, 2);
});
