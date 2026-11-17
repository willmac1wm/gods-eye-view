import assert from 'node:assert/strict';
import test from 'node:test';
import {
  outagesProxy,
  outagesUpstreamUrls,
  OUTAGES_PROXY_TTL_MS,
  OUTAGES_PROXY_USER_AGENT,
} from './outages.js';

// Obviously fake key used only to prove the proxy never leaks it.
const FAKE_KEY = 'test-key-not-real';
const T0 = 1_793_123_456_789;

const COUNTY = {
  data: {
    fips: '34009',
    customers_out: 99,
    customers_tracked: 113764,
    pct: 0.09,
    incident_count: 4,
    utilities: [
      {
        id: '963',
        etr: '2026-11-16T19:00:00Z',
        name: 'Atlantic City Electric Co',
        customers_out: 99,
      },
    ],
    worst_etr: '2026-11-16T19:00:00.000Z',
    updated_at: '2026-11-16T16:55:24.272Z',
    as_of: '2026-11-16T16:55:24.272Z',
    trend: null,
  },
  meta: { live: { status: 'ok' } },
};

const AREAS = {
  data: [
    {
      utility_key: '963',
      utility_name: 'Atlantic City Electric Co',
      area_type: 'muni',
      name: 'OCEAN CITY',
      customers_served: 22014,
      customers_out: 85,
      masked_outages: 0,
      incident_count: 1,
      etr: '2026-11-16T19:00:00.000Z',
      bbox: [-74.6552594577, 39.2068500528, -74.5402959701, 39.3100966021],
      as_of: '2026-11-16T17:00:41.427Z',
      pct_out: 0.386,
    },
  ],
};

const ALERTS = {
  data: {
    fips: '34009',
    thresholds: { major_event_pct: 10 },
    county: { customers_out: 99, pct_out: 0.17, above_threshold: false },
    utilities: [
      {
        utility_key: '963',
        name: 'Atlantic City Electric Co',
        connector_status: 'county',
        customers_out: 99,
        customers_served: 113764,
        pct_out: 0.08,
        above_threshold: false,
        major_event: false,
        visible: true,
      },
    ],
    areas_above_threshold: [],
    as_of: '2026-11-16T17:00:41.427Z',
  },
};

function mount({ fetchImpl, env = {} } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = outagesProxy({
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
  if (url.endsWith('/areas?active=true')) return json(AREAS);
  if (url.endsWith('/alerts')) return json(ALERTS);
  return json(COUNTY);
}

test('upstream URLs cover county, areas and alerts for FIPS 34009', () => {
  const urls = outagesUpstreamUrls();
  assert.equal(
    urls.county,
    'https://massoutage.com/api/v1/live/counties/34009',
  );
  assert.equal(
    urls.areas,
    'https://massoutage.com/api/v1/live/counties/34009/areas?active=true',
  );
  assert.equal(
    urls.alerts,
    'https://massoutage.com/api/v1/live/counties/34009/alerts',
  );
  assert.equal(
    OUTAGES_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('keyless → three batched upstream calls, county headline in the response', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const { mountPath, call } = mount({ fetchImpl, env: {} });
  assert.equal(mountPath, '/api/outages');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, OUTAGES_PROXY_TTL_MS);
  assert.equal(res.json.customersOut, 99);
  assert.equal(res.json.majorEvent, false);
  assert.equal(res.json.county.data.fips, '34009');
  assert.equal(res.json.areas.data.length, 1);
  assert.equal(res.json.alerts.data.utilities[0].name, 'Atlantic City Electric Co');
  assert.ok(!res.body.includes(FAKE_KEY));

  assert.equal(calls.length, 3);
  for (const callRecord of calls) {
    assert.equal(
      callRecord.options.headers['User-Agent'],
      OUTAGES_PROXY_USER_AGENT,
    );
    assert.equal(callRecord.options.headers.Accept, 'application/json');
    assert.equal(callRecord.options.headers.Authorization, undefined);
  }

  const status = await call('/status');
  assert.deepEqual(status.json, {
    hasKey: false,
    lastFetch: T0,
    stale: false,
    ttlMs: OUTAGES_PROXY_TTL_MS,
    customersOut: 99,
    majorEvent: false,
  });
});

test('with a key → Authorization Bearer, key never in the response', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const { call } = mount({
    fetchImpl,
    env: { MASSOUTAGE_API_KEY: FAKE_KEY },
  });
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.ok(!res.body.includes(FAKE_KEY));
  assert.equal(calls.length, 3);
  for (const callRecord of calls) {
    assert.equal(
      callRecord.options.headers.Authorization,
      `Bearer ${FAKE_KEY}`,
    );
  }
  const status = await call('/status');
  assert.equal(status.json.hasKey, true);
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => upstreamFor(url));
  const proxy = mount({ fetchImpl, env: {} });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 3);
  proxy.setTime(T0 + OUTAGES_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 6);
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
  const { call } = mount({ fetchImpl, env: {} });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 3);
});

test('upstream 500 with warm cache serves stale; with cold cache → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async (url) => {
    n += 1;
    return n <= 3 ? upstreamFor(url) : json({ error: 'down' }, 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl, env: {} });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + OUTAGES_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.customersOut, 99);
  assert.equal(flaky.calls.length, 6);

  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({ fetchImpl: failing.fetchImpl, env: {} });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(
    first.json.error,
    'MassOutage fetch failed and no cache available',
  );
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 3);
});

test('keyless 429 escalates: 10 min backoff before the next upstream try', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n <= 3
      ? json(null, 429, { 'Retry-After': '600' })
      : upstreamFor('');
  });
  const proxy = mount({ fetchImpl, env: {} });
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 3);
  // Retry-After: 600 s — no second upstream call before it expires.
  proxy.setTime(T0 + 9 * 60_000);
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 3);
  proxy.setTime(T0 + 10 * 60_000 + 1);
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 6);
});

test('a major-event utility surfaces majorEvent true', async () => {
  const major = {
    data: {
      ...ALERTS.data,
      utilities: [
        { ...ALERTS.data.utilities[0], major_event: true },
      ],
    },
  };
  const { fetchImpl } = stubUpstream(async (url) => {
    if (url.endsWith('/alerts')) return json(major);
    return upstreamFor(url);
  });
  const { call } = mount({ fetchImpl, env: {} });
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.majorEvent, true);
});
