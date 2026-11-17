import assert from 'node:assert/strict';
import test from 'node:test';
import { droughtProxy, DROUGHT_PROXY_TTL_MS } from './drought.js';

const T0 = 1_793_123_456_789;
const LAST_MODIFIED = 'Thu, 12 Nov 2026 11:15:51 GMT';

// Fixture polygons: a D0 square around the county seat, a D1 square over
// the northwest corner of the county bbox. (Live map 2026-11-16: the
// county seat is in the real D0 polygon and nowhere else.)
const D0_SQUARE = [
  [-75.1, 38.95],
  [-74.7, 38.95],
  [-74.7, 39.2],
  [-75.1, 39.2],
  [-75.1, 38.95],
];
const D1_SQUARE = [
  [-75.2, 39.25],
  [-74.95, 39.25],
  [-74.95, 39.4],
  [-75.2, 39.4],
  [-75.2, 39.25],
];

function usdmPayload(withD1 = false) {
  const features = [
    {
      type: 'Feature',
      properties: { DM: 0 },
      geometry: { type: 'MultiPolygon', coordinates: [[D0_SQUARE]] },
    },
  ];
  if (withD1) {
    features.push({
      type: 'Feature',
      properties: { DM: 1 },
      geometry: { type: 'Polygon', coordinates: [D1_SQUARE] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = droughtProxy({
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

function okUsdm(withD1 = false) {
  return new Response(JSON.stringify(usdmPayload(withD1)), {
    status: 200,
    headers: { 'Last-Modified': LAST_MODIFIED, 'Content-Type': 'application/json' },
  });
}

test('first call runs the county-max rule and serves D0 (live result)', async () => {
  const calls = [];
  const m = mount({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okUsdm(false);
    },
  });
  assert.equal(m.mountPath, '/api/drought');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.category, 0);
  assert.equal(res.json.releasedAt, LAST_MODIFIED);
  assert.equal(res.json.ttlMs, DROUGHT_PROXY_TTL_MS);
  assert.equal(res.json.categories.length, 7);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /droughtmonitor\.unl\.edu\/data\/json\/usdm_current\.json/);

  const status = await m.call('/status');
  assert.equal(status.json.category, 0);
  assert.equal(status.json.releasedAt, LAST_MODIFIED);
});

test('a D1 polygon over a sample point raises the county category to D1', async () => {
  const m = mount({ fetchImpl: async () => okUsdm(true) });
  const res = await m.call('/');
  assert.equal(res.json.category, 1);
});

test('a second call inside the TTL is a cache hit (no second fetch)', async () => {
  let calls = 0;
  const m = mount({
    fetchImpl: async () => {
      calls += 1;
      return okUsdm(false);
    },
  });
  await m.call('/');
  await m.call('/');
  assert.equal(calls, 1);
});

test('after the TTL, an upstream 500 serves the stale cache', async () => {
  let fail = false;
  const m = mount({
    fetchImpl: async () =>
      fail ? new Response('boom', { status: 500 }) : okUsdm(false),
  });
  const fresh = await m.call('/');
  assert.equal(fresh.json.stale, false);
  fail = true;
  m.setTime(T0 + DROUGHT_PROXY_TTL_MS + 1);
  const stale = await m.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.category, 0);
  assert.match(m.warnings.join(' '), /refresh failed/);
});

test('a cold cache with a failing upstream answers 502', async () => {
  const m = mount({
    fetchImpl: async () => new Response('boom', { status: 500 }),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
  assert.match(res.json.error, /no cache available/);
});
