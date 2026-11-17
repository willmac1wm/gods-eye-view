import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COPERNICUS_PROXY_TTL_MS,
  copernicusProxy,
} from './copernicus.js';

const T0 = 1_793_123_456_789;

// The real OData row returned live for the county point, 2026-11-17.
const LIVE_ROW = {
  Id: 'e4de0c65-5ae6-4034-999c-a688454733b7',
  Name: 'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
  ContentDate: { Start: '2023-05-25T15:49:41.024000Z' },
};

function okOdata(rows = [LIVE_ROW]) {
  return new Response(JSON.stringify({ value: rows }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The drought mount harness: one handler at /api/satellite-verification,
// with /status as a sub-path on the same handler (req.url '/status').
function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const warnings = [];
  const plugin = copernicusProxy({
    fetchImpl,
    now: () => currentTime,
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
  const call = async (subPath) => {
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
    await handler({ url: subPath }, res);
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

test('first call queries SENTINEL-2 over the county point, newest first', async () => {
  const calls = [];
  const m = mount({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okOdata();
    },
  });
  assert.equal(m.mountPath, '/api/satellite-verification');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.collection, 'SENTINEL-2');
  assert.equal(res.json.products.length, 1);
  assert.equal(res.json.products[0].tile, 'T18SVJ');
  assert.equal(res.json.products[0].countyTile, true);
  assert.equal(res.json.ttlMs, COPERNICUS_PROXY_TTL_MS);
  assert.equal(calls.length, 1);
  const url = String(calls[0].url);
  assert.ok(url.startsWith('https://catalogue.dataspace.copernicus.eu/odata/v1/Products'));
  assert.ok(url.includes("Collection%2FName+eq+%27SENTINEL-2%27"));
  assert.ok(url.includes('POINT%28-74.9+39%29'));
  assert.ok(url.includes('ContentDate%2FStart+desc'));
  assert.ok(url.includes('%24top=10'));

  const status = await m.call('/status');
  assert.equal(status.json.productCount, 1);
  assert.equal(status.json.stale, false);
});

test('a second call inside the TTL is a cache hit (no second fetch)', async () => {
  let calls = 0;
  const m = mount({
    fetchImpl: async () => {
      calls += 1;
      return okOdata();
    },
  });
  await m.call('/');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.equal(res.json.products.length, 1);
});

test('after the TTL a fresh fetch runs; an upstream failure serves stale', async () => {
  let calls = 0;
  let fail = false;
  const m = mount({
    fetchImpl: async () => {
      calls += 1;
      if (fail) return new Response('bad gateway', { status: 502 });
      return okOdata();
    },
  });
  const first = await m.call('/');
  assert.equal(first.json.stale, false);
  m.setTime(T0 + COPERNICUS_PROXY_TTL_MS + 1);
  fail = true;
  const stale = await m.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.products.length, 1);
  assert.equal(calls, 2);
});

test('no cache + upstream down is a 502 with the upstream status', async () => {
  const m = mount({
    fetchImpl: async () => new Response('bad gateway', { status: 502 }),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
  assert.equal(
    res.json.error,
    'Copernicus catalogue failed and no cache available',
  );
});

test('status before any fetch reports an empty catalogue', async () => {
  const m = mount({ fetchImpl: async () => okOdata() });
  const res = await m.call('/status');
  assert.equal(res.status, 200);
  // status with no fetch yet: the plugin has no cache.
  assert.equal(res.json.productCount, null);
  assert.equal(res.json.lastFetch, null);
  assert.equal(res.json.stale, false);
});
