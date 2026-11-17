import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSidecarMiddleware,
  resolveSidecarUrl,
  sidecarAllowed,
} from './sidecar.js';

function fakeRes() {
  const headers = new Map();
  const res = {
    statusCode: 200,
    headers,
    body: undefined,
    ended: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(body) {
      this.body = body;
      this.ended = true;
    },
  };
  return res;
}

function fakeFetch(body, { status = 200, type = 'application/json' } = {}) {
  let calls = 0;
  let lastUrl = null;
  const fetchImpl = async (url) => {
    calls += 1;
    lastUrl = String(url);
    return {
      status,
      headers: {
        get: (name) =>
          String(name).toLowerCase() === 'content-type' ? type : null,
      },
      arrayBuffer: async () => Buffer.from(body),
    };
  };
  return {
    fetchImpl,
    calls: () => calls,
    lastUrl: () => lastUrl,
  };
}

test('resolveSidecarUrl defaults to loopback 8120', () => {
  assert.equal(resolveSidecarUrl({}), 'http://127.0.0.1:8120');
  assert.equal(
    resolveSidecarUrl({ SIDECAR_URL: 'http://127.0.0.1:8120/' }),
    'http://127.0.0.1:8120',
  );
  assert.equal(
    resolveSidecarUrl({ SIDECAR_URL: 'https://sidecar.internal:8120' }),
    'https://sidecar.internal:8120',
  );
  // Unparseable or non-http(s) values fail closed to the loopback default.
  assert.equal(resolveSidecarUrl({ SIDECAR_URL: 'nota url' }), 'http://127.0.0.1:8120');
  assert.equal(resolveSidecarUrl({ SIDECAR_URL: 'ftp://x/y' }), 'http://127.0.0.1:8120');
});

test('sidecarAllowed permits news/alert paths, blocks traversal and depth', () => {
  assert.equal(sidecarAllowed('/'), true);
  assert.equal(sidecarAllowed('/latest'), true);
  assert.equal(sidecarAllowed('/feed.xml'), true);
  assert.equal(sidecarAllowed('/some-story-slug'), true);
  assert.equal(sidecarAllowed('/acars-smoke-on-board-ua915'), true);
  assert.equal(sidecarAllowed('/a/b'), false);
  assert.equal(sidecarAllowed('/../etc'), false);
  assert.equal(sidecarAllowed('/..%2fetc'), false);
});

test('middleware proxies the same path to the sidecar and passes the body through', async () => {
  const stub = fakeFetch('{"count":1,"items":[]}');
  const mw = createSidecarMiddleware({
    baseUrl: 'http://127.0.0.1:8120',
    prefix: '/api/news',
    fetchImpl: stub.fetchImpl,
  });
  const res = fakeRes();
  await mw({ method: 'GET', url: '/latest?limit=3', headers: {} }, res, () => {
    throw new Error('next() must not be called for a sidecar path');
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'application/json');
  assert.equal(res.getHeader('x-sidecar'), '1');
  assert.equal(String(res.body), '{"count":1,"items":[]}');
  assert.equal(
    stub.lastUrl(),
    'http://127.0.0.1:8120/api/news/latest?limit=3',
  );
});

test('middleware serves a second identical request from cache', async () => {
  const stub = fakeFetch('{"count":0,"items":[]}');
  const mw = createSidecarMiddleware({
    baseUrl: 'http://127.0.0.1:8120',
    prefix: '/api/alerts',
    fetchImpl: stub.fetchImpl,
  });
  await mw({ method: 'GET', url: '/?limit=10', headers: {} }, fakeRes(), () => {});
  await mw({ method: 'GET', url: '/?limit=10', headers: {} }, fakeRes(), () => {});
  assert.equal(stub.calls(), 1);
});

test('middleware answers 502 JSON when the sidecar is down (API path)', async () => {
  const mw = createSidecarMiddleware({
    baseUrl: 'http://127.0.0.1:8120',
    prefix: '/api/news',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  const res = fakeRes();
  await mw({ method: 'GET', url: '/latest', headers: {} }, res, () => {});
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(String(res.body)).error, 'sidecar_unavailable');
});

test('middleware answers 502 HTML when the sidecar is down (page path)', async () => {
  const mw = createSidecarMiddleware({
    baseUrl: 'http://127.0.0.1:8120',
    prefix: '/news',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  const res = fakeRes();
  await mw(
    { method: 'GET', url: '/', headers: { accept: 'text/html' } },
    res,
    () => {},
  );
  assert.equal(res.statusCode, 502);
  assert.match(String(res.getHeader('content-type')), /text\/html/);
  assert.match(String(res.body), /news is unavailable/);
});

test('middleware rejects non-GET methods and passes unknown paths to next()', async () => {
  const stub = fakeFetch('{}');
  const mw = createSidecarMiddleware({
    baseUrl: 'http://127.0.0.1:8120',
    prefix: '/news',
    fetchImpl: stub.fetchImpl,
  });
  const post = fakeRes();
  await mw({ method: 'POST', url: '/', headers: {} }, post, () => {});
  assert.equal(post.statusCode, 405);

  let nextCalled = false;
  await mw({ method: 'GET', url: '/a/b', headers: {} }, fakeRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(stub.calls(), 0);
});
