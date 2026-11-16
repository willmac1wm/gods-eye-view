import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gaugesProxy,
  gaugesUpstreamUrl,
  GAUGES_PROXY_TTL_MS,
  GAUGES_PROXY_USER_AGENT,
} from './gauges.js';

const T0 = 1_793_123_456_789;

const FEATURES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411000',
        parameter_code: '00065',
        time: '2026-11-16T17:00:00+00:00',
        value: '3.76',
        unit_of_measure: 'ft',
        approval_status: 'Provisional',
        qualifier: null,
      },
    },
  ],
};

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = gaugesProxy({
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

test('upstream URL batches both sites and both parameters in one call', () => {
  const url = new URL(gaugesUpstreamUrl());
  assert.equal(
    url.origin + url.pathname,
    'https://api.waterdata.usgs.gov/ogcapi/v1/collections/latest-continuous/items',
  );
  assert.equal(url.searchParams.get('f'), 'json');
  assert.equal(
    url.searchParams.get('monitoring_location_id'),
    'USGS-01411000,USGS-01411300',
  );
  assert.equal(url.searchParams.get('parameter_code'), '00060,00065');
  assert.equal(
    GAUGES_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('one upstream call per refresh, no key of any kind', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => json(FEATURES));
  const { mountPath, call } = mount({ fetchImpl });
  assert.equal(mountPath, '/api/gauges');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, GAUGES_PROXY_TTL_MS);
  assert.equal(res.json.readingCount, 1);
  assert.equal(res.json.features.features.length, 1);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].options.headers['User-Agent'],
    GAUGES_PROXY_USER_AGENT,
  );
  assert.equal(calls[0].options.headers.Authorization, undefined);

  const status = await call('/status');
  assert.deepEqual(status.json, {
    lastFetch: T0,
    stale: false,
    ttlMs: GAUGES_PROXY_TTL_MS,
    gaugeCount: 2,
    readingCount: 1,
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => json(FEATURES));
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + GAUGES_PROXY_TTL_MS + 1);
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
    return json(FEATURES);
  });
  const { call } = mount({ fetchImpl });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 1);
});

test('upstream 500 with warm cache serves stale; with cold cache → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async () => {
    n += 1;
    return n === 1 ? json(FEATURES) : json({ error: 'down' }, 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + GAUGES_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.readingCount, 1);
  assert.equal(flaky.calls.length, 2);

  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({ fetchImpl: failing.fetchImpl });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'USGS fetch failed and no cache available');
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 1);
});

test('429 backs off on Retry-After, then retries', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n === 1
      ? json(null, 429, { 'Retry-After': '120' })
      : json(FEATURES);
  });
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 120_000 + 1);
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});
