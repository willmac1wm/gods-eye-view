import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardNativeHandler } from './boardNative.js';
import { createFloodNativeHandlers } from './floodNative.js';
import { createOutagesNativeHandler } from './outagesNative.js';
import { createPermitsNativeHandler } from './permitsNative.js';

// Regression: these four handlers called the same-site gate inverted
// (`if (!admitSameSiteKeyless(req, res)) return;`). `admitSameSiteKeyless`
// returns true when it has already answered 403 and false when the handler
// should continue, so the inversion made admitted loopback requests return
// with no response (the connection hung until the client timed out) while
// refused cross-site requests proceeded. Every other handler in the repo
// uses `if (admitSameSiteKeyless(req, res)) return;`.

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(body) {
      this.body = body;
      this.ended = true;
    },
  };
  return res;
}

function fakeReq({ method = 'GET', url = '/', origin, secFetchSite } = {}) {
  const headers = { host: '127.0.0.1:4199' };
  if (origin) headers.origin = origin;
  if (secFetchSite) headers['sec-fetch-site'] = secFetchSite;
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

// Offline upstream: every fetch fails soft, so the handlers answer from
// their empty/fallback payloads without touching the network.
async function offlineFetch() {
  return { ok: false, status: 404, json: async () => ({}) };
}

const refusedReq = () =>
  fakeReq({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });

test('board native handler answers admitted requests and 403s cross-site ones', async () => {
  const handler = createBoardNativeHandler({
    getMessages: async () => [],
    fetchImpl: offlineFetch,
  });
  const admitted = fakeRes();
  await handler(fakeReq(), admitted);
  assert.equal(admitted.ended, true);
  assert.equal(admitted.statusCode, 200);
  assert.equal(JSON.parse(admitted.body).source, 'native');

  const refused = fakeRes();
  await handler(refusedReq(), refused);
  assert.equal(refused.ended, true);
  assert.equal(refused.statusCode, 403);
});

test('flood native handler answers admitted requests and 403s cross-site ones', async () => {
  const { allHandler } = createFloodNativeHandlers({ fetchImpl: offlineFetch });
  const admitted = fakeRes();
  await allHandler(fakeReq(), admitted);
  assert.equal(admitted.ended, true);
  assert.equal(admitted.statusCode, 200);
  assert.equal(JSON.parse(admitted.body).source, 'native');

  const refused = fakeRes();
  await allHandler(refusedReq(), refused);
  assert.equal(refused.ended, true);
  assert.equal(refused.statusCode, 403);
});

test('outages native handler answers admitted requests and 403s cross-site ones', async () => {
  const handler = createOutagesNativeHandler({ fetchImpl: offlineFetch });
  const admitted = fakeRes();
  await handler(fakeReq(), admitted);
  assert.equal(admitted.ended, true);
  assert.equal(admitted.statusCode, 200);

  const refused = fakeRes();
  await handler(refusedReq(), refused);
  assert.equal(refused.ended, true);
  assert.equal(refused.statusCode, 403);
});

test('permits native handler reaches its method check for admitted requests and 403s cross-site ones', async () => {
  // An admitted non-GET/HEAD request is answered 405 before any upstream
  // fetch, so this exercises the gate without needing DCA stubs.
  const handler = createPermitsNativeHandler({ fetchImpl: offlineFetch });
  const admitted = fakeRes();
  await handler(fakeReq({ method: 'POST' }), admitted);
  assert.equal(admitted.ended, true);
  assert.equal(admitted.statusCode, 405);

  const refused = fakeRes();
  await handler(refusedReq(), refused);
  assert.equal(refused.ended, true);
  assert.equal(refused.statusCode, 403);
});
