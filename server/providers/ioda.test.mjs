// server/providers/ioda.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  iodaProxy,
  iodaUpstreamUrl,
  IODA_PROXY_TTL_MS,
  IODA_PROXY_USER_AGENT,
} from './ioda.js';

const T0 = 1_793_123_456_789;

// Verbatim live IODA rows from 2026-11-17 (global alerts, ASN summary).
const CRITICAL_ALERT = {
  datasource: 'bgp',
  entity: {
    code: '7821',
    name: 'AS7821 (ZAYO-MN)',
    subnames: [],
    type: 'asn',
    attrs: {
      name: 'ZAYO-MN',
      fqid: 'asn.7821',
      ip_count: '9472',
      org: 'Inteliquent, inc.',
    },
  },
  time: 1794822000,
  level: 'critical',
  condition: '< 0.99',
  value: 0,
  historyValue: 37,
  method: 'median',
};

const NORMAL_ALERT = {
  datasource: 'bgp',
  entity: {
    code: '58540',
    name: 'AS58540 (CHINATELECOM-SHANDONG-JINAN-IDC)',
    subnames: [],
    type: 'asn',
    attrs: {
      ip_count: '86016',
      name: 'CHINATELECOM-SHANDONG-JINAN-IDC',
      org: 'Jinan,250000',
      fqid: 'asn.58540',
    },
  },
  time: 1794822000,
  level: 'normal',
  condition: 'normal',
  value: 332,
  historyValue: 332,
  method: 'median',
};

const SUMMARY_ROW = {
  scores: { 'bgp.median': 855760, overall: 855760 },
  event_cnt: 207,
  entity: {
    code: '7821',
    name: 'AS7821 (ZAYO-MN)',
    subnames: [],
    type: 'asn',
    attrs: {
      name: 'ZAYO-MN',
      fqid: 'asn.7821',
      ip_count: '9472',
      org: 'Inteliquent, inc.',
    },
  },
};

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = iodaProxy({
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

/** Route by scope: US summary, NJ summary, global alerts. */
function liveUpstream() {
  return stubUpstream(async (url) => {
    if (url.includes('/outages/summary') && url.includes('entityCode=US'))
      return json({ type: 'outages.summary', data: [] });
    if (url.includes('/outages/summary') && url.includes('entityCode=4453'))
      return json({ type: 'outages.summary', data: [] });
    if (url.includes('/outages/alerts'))
      return json({
        type: 'outages.alerts',
        data: [CRITICAL_ALERT, NORMAL_ALERT],
      });
    return json({ error: 'not found' }, 404);
  });
}

test('the upstream base is the IODA v2 API, no key of any kind', () => {
  assert.equal(
    iodaUpstreamUrl(),
    'https://api.ioda.inetintel.cc.gatech.edu/v2',
  );
  assert.equal(
    IODA_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('one refresh polls all three scopes; quiet summaries are real results', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const { mountPath, call } = mount({ fetchImpl });
  assert.equal(mountPath, '/api/internet-outages');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, IODA_PROXY_TTL_MS);
  assert.deepEqual(res.json.usSummary, []);
  assert.deepEqual(res.json.njSummary, []);
  assert.equal(res.json.alerts.length, 2);
  assert.equal(res.json.alerts[0].level, 'critical');
  assert.deepEqual(res.json.sources, {
    usSummary: { ok: true, count: 0 },
    njSummary: { ok: true, count: 0 },
    alerts: { ok: true, count: 2 },
  });

  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.ioda.inetintel.cc.gatech.edu/v2/')));
  assert.ok(
    calls.some((c) => c.url.includes('entityType=region&entityCode=4453')),
  );
  assert.ok(calls.every((c) => c.options.headers['User-Agent'] === IODA_PROXY_USER_AGENT));
  assert.ok(calls.every((c) => c.options.headers.Authorization === undefined));

  const status = await call('/status');
  assert.equal(status.json.lastFetch, T0);
  assert.equal(status.json.stale, false);
  assert.deepEqual(status.json.counts, {
    usSummary: 0,
    njSummary: 0,
    alerts: 2,
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 3);
  proxy.setTime(T0 + IODA_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 6);
});

test('concurrent requests share one upstream refresh (single-flight)', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { fetchImpl, calls } = stubUpstream(async (url) => {
    await gate;
    if (url.includes('/outages/alerts'))
      return json({ type: 'outages.alerts', data: [CRITICAL_ALERT] });
    return json({ type: 'outages.summary', data: [] });
  });
  const { call } = mount({ fetchImpl });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 3);
});

test('one scope down still serves the others, marked ok:false', async () => {
  const { fetchImpl } = stubUpstream(async (url) => {
    if (url.includes('/outages/alerts')) return json({ error: 'down' }, 500);
    if (url.includes('entityCode=US'))
      return json({ type: 'outages.summary', data: [SUMMARY_ROW] });
    return json({ type: 'outages.summary', data: [] });
  });
  const proxy = mount({ fetchImpl });
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.alerts.length, 0);
  assert.equal(res.json.sources.alerts.ok, false);
  assert.equal(res.json.usSummary.length, 1);
  assert.equal(res.json.usSummary[0].entity.code, '7821');
  assert.equal(res.json.sources.usSummary.ok, true);
});

test('upstream 500 on all scopes with warm cache serves stale; cold → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async () => {
    n += 1;
    // First refresh (3 calls) succeeds; every later call fails.
    if (n <= 3) return json({ type: 'outages.summary', data: [] });
    return json({ error: 'down' }, 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl });
  const first = await proxy.call('/');
  assert.equal(first.status, 200);
  proxy.setTime(T0 + IODA_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(flaky.calls.length, 6);

  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({ fetchImpl: failing.fetchImpl });
  const coldFirst = await cold.call('/');
  assert.equal(coldFirst.status, 502);
  assert.equal(coldFirst.json.error, 'IODA fetch failed and no cache available');
  const coldSecond = await cold.call('/');
  assert.equal(coldSecond.status, 502);
  assert.equal(failing.calls.length, 3);
});

test('429 on all scopes backs off on Retry-After, then retries', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n <= 3
      ? json('slow down', 429, { 'Retry-After': '2' })
      : json({ type: 'outages.summary', data: [] });
  });
  const proxy = mount({ fetchImpl });
  const first = await proxy.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'IODA rate limited (HTTP 429)');
  assert.equal(calls.length, 3);
  proxy.setTime(T0 + 1_000);
  const backedOff = await proxy.call('/');
  assert.equal(backedOff.status, 502);
  assert.equal(calls.length, 3);
  proxy.setTime(T0 + 2_001);
  const retried = await proxy.call('/');
  assert.equal(retried.status, 200);
  assert.equal(calls.length, 6);
});

test('a non-IODA payload on a scope fails that scope, not the refresh', async () => {
  const { fetchImpl } = stubUpstream(async (url) => {
    if (url.includes('/outages/alerts'))
      return json({ wrong: 'shape' });
    return json({ type: 'outages.summary', data: [] });
  });
  const proxy = mount({ fetchImpl });
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.sources.alerts.ok, false);
  assert.equal(res.json.sources.usSummary.ok, true);
});
