import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { STREAM_UA, createAtcLiveHandlers, ingestEnabled } from './atcLive.js';
import { DEFAULT_ATC_MOUNTS } from './atcMounts.js';

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.body = '';
  res.headersSent = false;
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.write = () => true;
  res.end = (chunk) => {
    res.headersSent = true;
    if (chunk) res.body += String(chunk);
    res.emit('finish');
  };
  return res;
}

function mockReq(url = '/', method = 'GET') {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: '127.0.0.1:5173' };
  req.socket = { encrypted: false, remoteAddress: '127.0.0.1' };
  return req;
}

async function waitEnd(res) {
  if (res.headersSent) return;
  await new Promise((resolve) => res.once('finish', resolve));
}

test('STREAM_UA is a fixed desktop Chrome browser string', () => {
  assert.match(STREAM_UA, /Mozilla\/5\.0/);
  assert.match(STREAM_UA, /Chrome\//);
  assert.doesNotMatch(STREAM_UA, /VLC|LibVLC/i);
});

test('DEFAULT_ATC_MOUNTS enables kacy, kwwd, and kmiv_awos', () => {
  const byId = Object.fromEntries(DEFAULT_ATC_MOUNTS.map((m) => [m.id, m]));
  assert.equal(byId.kacy_a_twr.enabled, true);
  assert.equal(byId.kwwd_twr.enabled, true);
  assert.equal(byId.kmiv_awos.enabled, true);
});

test('403 from LiveATC records exact status and switches to link_out_only', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), ua: init?.headers?.['User-Agent'] });
    return {
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: () => 'text/html' },
      async text() {
        return '<html>Access Denied — Terms of Service</html>';
      },
      body: null,
    };
  };
  const handlers = createAtcLiveHandlers({
    fetchImpl,
    env: { ATC_LIVEATC_INGEST: '0' },
    now: () => 1_000_000,
    backoffMs: 60_000,
    storePath: `/tmp/gev-atc-test-${process.pid}-403.json`,
  });

  const sample = await handlers.sampleMountBytes({
    id: 'kacy_a_twr',
    mount: 'kacy_a_twr',
  });
  assert.equal(sample.ok, false);
  assert.equal(sample.status, 403);
  assert.equal(calls[0].ua, STREAM_UA);

  const res = mockRes();
  await handlers.handleFeeds(mockReq('/api/ops/atc/feeds'), res);
  await waitEnd(res);
  const body = JSON.parse(res.body);
  assert.equal(body.policy, 'link_out_only');
  assert.equal(body.block.status, 403);
  assert.match(body.block.bodySnippet, /Access Denied/i);
  assert.equal(body.feeds[0].stream_url, null);
});

test('429 triggers backoff and refuses further stream without a second upstream hit', async () => {
  let hits = 0;
  const fetchImpl = async () => {
    hits += 1;
    return {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: { get: () => 'text/plain' },
      async text() {
        return 'rate limited by liveatc';
      },
      body: null,
    };
  };
  const handlers = createAtcLiveHandlers({
    fetchImpl,
    env: { ATC_LIVEATC_INGEST: '0' },
    now: () => 2_000_000,
    backoffMs: 60_000,
    storePath: `/tmp/gev-atc-test-${process.pid}-429.json`,
  });

  await handlers.sampleMountBytes({ id: 'kacy_a_twr', mount: 'kacy_a_twr' });
  assert.equal(hits, 1);

  const res = mockRes();
  await handlers.handleStream(
    mockReq('/api/ops/atc/stream?mount=kacy_a_twr'),
    res,
  );
  await waitEnd(res);
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'liveatc_blocked');
  assert.equal(body.block.status, 429);
  assert.equal(hits, 1, 'must not hammer LiveATC while backing off');
});

test('hanging upstream fails fast into link-out fallback (no endless Listen)', async () => {
  const timeoutError = new Error('The operation timed out.');
  timeoutError.name = 'TimeoutError';
  const fetchImpl = async () => {
    throw timeoutError;
  };
  const handlers = createAtcLiveHandlers({
    fetchImpl,
    env: { ATC_LIVEATC_INGEST: '0' },
    now: () => 2_000_000,
    backoffMs: 60_000,
    storePath: `/tmp/gev-atc-test-${process.pid}-timeout.json`,
  });

  const res = mockRes();
  await handlers.handleStream(
    mockReq('/api/ops/atc/stream?mount=kacy_a_twr'),
    res,
  );
  await waitEnd(res);
  assert.equal(res.statusCode, 503);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'liveatc_blocked');
  assert.equal(body.policy, 'link_out_only');
});

test('upstream mutex serializes concurrent samples (one at a time)', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const fetchImpl = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 40));
    concurrent -= 1;
    const chunks = [new Uint8Array([1, 2, 3, 4])];
    let i = 0;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'audio/mpeg' },
      body: {
        getReader() {
          return {
            async read() {
              if (i >= chunks.length) return { done: true, value: undefined };
              return { done: false, value: chunks[i++] };
            },
            async cancel() {},
          };
        },
      },
    };
  };
  const handlers = createAtcLiveHandlers({
    fetchImpl,
    env: { ATC_LIVEATC_INGEST: '0' },
    storePath: `/tmp/gev-atc-test-${process.pid}-mutex.json`,
  });

  await Promise.all([
    handlers.sampleMountBytes({ id: 'kacy_a_twr', mount: 'kacy_a_twr' }),
    handlers.sampleMountBytes({ id: 'kwwd_twr', mount: 'kwwd_twr' }),
    handlers.sampleMountBytes({ id: 'kmiv_awos', mount: 'kmiv_awos' }),
  ]);
  assert.equal(maxConcurrent, 1);
});

test('feeds/health responses are cached within TTL', async () => {
  let now = 5_000_000;
  const handlers = createAtcLiveHandlers({
    fetchImpl: async () => {
      throw new Error('no upstream');
    },
    env: { ATC_LIVEATC_INGEST: '0' },
    now: () => now,
    storePath: `/tmp/gev-atc-test-${process.pid}-cache.json`,
  });

  const r1 = mockRes();
  await handlers.handleFeeds(mockReq('/api/ops/atc/feeds'), r1);
  await waitEnd(r1);
  const first = r1.body;

  // Mutate internal link-out via sample would change body; instead advance
  // clock within TTL and confirm identical cached payload object path.
  now += 5_000;
  const r2 = mockRes();
  await handlers.handleFeeds(mockReq('/api/ops/atc/feeds'), r2);
  await waitEnd(r2);
  assert.equal(r2.body, first);
  assert.ok(String(r2.headers['cache-control'] || '').includes('max-age'));
});

test('ingestEnabled is explicit ATC_LIVEATC_INGEST only (OpenAI key ignored)', () => {
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: 'sk', ATC_LIVEATC_INGEST: '' }),
    false,
  );
  assert.equal(
    ingestEnabled({ OPENAI_API_KEY: '', ATC_LIVEATC_INGEST: '0' }),
    false,
  );
  assert.equal(ingestEnabled({ ATC_LIVEATC_INGEST: '1' }), true);
});
