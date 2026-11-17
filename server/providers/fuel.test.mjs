import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fuelProxy,
  eiaFuelUpstreamUrl,
  FUEL_PROXY_TTL_MS,
  FUEL_PROXY_USER_AGENT,
} from './fuel.js';

// Obviously fake key used only to prove the proxy never leaks it.
const FAKE_KEY = 'test-key-not-real';
const T0 = 1_793_123_456_789;

function eiaPayload(rows) {
  return {
    response: {
      total: String(rows.length),
      dateFormat: 'YYYY-MM-DD',
      frequency: 'weekly',
      data: rows,
    },
  };
}

const GND = eiaPayload([
  {
    period: '2026-11-09',
    series: 'EMM_EPMR_PTE_R1Y_DPG',
    value: 4.146,
    units: '$/GAL',
  },
  {
    period: '2026-11-09',
    series: 'EMD_EPD2D_PTE_R1Y_DPG',
    value: 6.412,
    units: '$/GAL',
  },
]);

const WFR = eiaPayload([
  {
    period: '2026-11-09',
    series: 'W_EPD2F_PRS_SNJ_DPG',
    value: 6.052,
    units: '$/GAL',
  },
]);

function mount({ fetchImpl, env = {} } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = fuelProxy({
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

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function upstreamFor(url) {
  if (url.includes('/wfr/')) return json(WFR);
  return json(GND);
}

test('upstream URLs hit the gnd and wfr routes with the tracked series', () => {
  for (const route of ['gnd', 'wfr']) {
    const url = new URL(eiaFuelUpstreamUrl(route));
    assert.equal(
      url.origin + url.pathname,
      `https://api.eia.gov/v2/petroleum/pri/${route}/data/`,
    );
    assert.equal(url.searchParams.get('frequency'), 'weekly');
    assert.equal(url.searchParams.get('data[0]'), 'value');
    assert.equal(url.searchParams.get('sort[0][column]'), 'period');
    assert.equal(url.searchParams.get('sort[0][direction]'), 'desc');
  }
  const gndSeries = new URL(eiaFuelUpstreamUrl('gnd')).searchParams.getAll(
    'facets[series][]',
  );
  assert.deepEqual(gndSeries, [
    'EMM_EPMR_PTE_NUS_DPG',
    'EMM_EPMR_PTE_R1Y_DPG',
    'EMD_EPD2D_PTE_NUS_DPG',
    'EMD_EPD2D_PTE_R1Y_DPG',
  ]);
  const wfrSeries = new URL(eiaFuelUpstreamUrl('wfr')).searchParams.getAll(
    'facets[series][]',
  );
  assert.deepEqual(wfrSeries, [
    'W_EPD2F_PRS_NUS_DPG',
    'W_EPD2F_PRS_R1Y_DPG',
    'W_EPD2F_PRS_SNJ_DPG',
  ]);
  assert.equal(
    FUEL_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('no key → 503 no_key, status hasKey false, upstream never called', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const { mountPath, call } = mount({ fetchImpl, env: {} });
  assert.equal(mountPath, '/api/fuel');

  const res = await call('/');
  assert.equal(res.status, 503);
  assert.deepEqual(res.json, { error: 'no_key' });
  assert.equal(calls.length, 0);

  const status = await call('/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, {
    hasKey: false,
    lastFetch: null,
    stale: false,
    ttlMs: FUEL_PROXY_TTL_MS,
    latestWeek: null,
  });
  assert.equal(calls.length, 0);
});

test('with key → two upstream calls with X-Api-Key, key never in the response', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const { call } = mount({ fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, FUEL_PROXY_TTL_MS);
  assert.equal(res.json.latestWeek, '2026-11-09');
  assert.equal(res.json.gnd.response.data.length, 2);
  assert.equal(res.json.wfr.response.data.length, 1);
  assert.ok(!res.body.includes(FAKE_KEY), 'key leaked into the response');

  assert.equal(calls.length, 2);
  for (const callRecord of calls) {
    assert.equal(callRecord.options.headers['X-Api-Key'], FAKE_KEY);
    assert.equal(
      callRecord.options.headers['User-Agent'],
      FUEL_PROXY_USER_AGENT,
    );
    assert.ok(
      !callRecord.url.includes(FAKE_KEY),
      'key leaked into the URL',
    );
  }

  const status = await call('/status');
  assert.deepEqual(status.json, {
    hasKey: true,
    lastFetch: T0,
    stale: false,
    ttlMs: FUEL_PROXY_TTL_MS,
    latestWeek: '2026-11-09',
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const proxy = mount({ fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 2);
  proxy.setTime(T0 + FUEL_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 4);
});

test('concurrent requests share one upstream pass (single-flight)', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { fetchImpl, calls } = stubUpstream(async (url) => {
    await gate;
    return upstreamFor(url);
  });
  const { call } = mount({ fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 2);
});

test('upstream 500 with warm cache serves stale; with cold cache → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async (url) => {
    n += 1;
    return n <= 2 ? upstreamFor(url) : json({ error: 'down' }, 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + FUEL_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.latestWeek, '2026-11-09');
  assert.equal(flaky.calls.length, 4);

  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({ fetchImpl: failing.fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'EIA fetch failed and no cache available');
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 2);
});

test('429 backs off on Retry-After, then retries', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async (url) => {
    n += 1;
    return n <= 2
      ? json(null, 429, { 'Retry-After': '120' })
      : upstreamFor(url);
  });
  const proxy = mount({ fetchImpl, env: { EIA_API_KEY: FAKE_KEY } });
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 2);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 2);
  proxy.setTime(T0 + 120_000 + 1);
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 4);
});
