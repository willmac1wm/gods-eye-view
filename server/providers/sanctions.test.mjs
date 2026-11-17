// server/providers/sanctions.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { sanctionsProxy } from './sanctions.js';

const T0 = 1_793_123_456_789;

// Live ArcNautical keyless check, IMO 9169067, 2026-11-17 ~03:19 UTC.
const LIVE_CHECK = {
  imo: '9169067',
  vesselName: 'MSC MIA SUMMER II',
  sanctions: {
    status: 'GREEN',
    detail: 'No matches across OFAC SDN, OpenSanctions, EU FSD, UN Consolidated, UK OFSI.',
    coverageComplete: true,
    coverageGaps: [],
  },
  ownership: { opacity: 'HIGH', score: 70 },
  vetting: { grade: 'C', score: 43, status: 'marginal' },
  checkedAt: '2026-11-17T03:19:09.016Z',
  fullReport: 'https://arcnautical.com/check?imo=9169067',
  tier: 'keyless',
};

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = sanctionsProxy({
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
      body: res.body ? JSON.parse(res.body) : null,
    };
  };
  return {
    mountPath,
    warnings,
    call,
    advance(ms) {
      currentTime += ms;
    },
  };
}

test('sanctions proxy mounts on /api/sanctions/check', () => {
  const { mountPath } = mount();
  assert.equal(mountPath, '/api/sanctions/check');
});

test('sanctions proxy returns the live GREEN check and caches it an hour', async () => {
  let calls = 0;
  const h = mount({
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(url, /arcnautical\.com\/api\/v1\/vessels\/9169067\/check/);
      return new Response(JSON.stringify(LIVE_CHECK), { status: 200 });
    },
  });
  const first = await h.call('?imo=9169067');
  assert.equal(first.status, 200);
  assert.equal(first.body.sanctionsStatus, 'GREEN');
  assert.equal(first.body.ownershipScore, 70);
  assert.equal(first.body.vettingGrade, 'C');
  assert.equal(first.body.stale, false);
  const second = await h.call('?imo=9169067');
  assert.equal(second.status, 200);
  assert.equal(second.body.stale, false);
  assert.equal(calls, 1);
  h.advance(61 * 60 * 1000);
  await h.call('?imo=9169067');
  assert.equal(calls, 2);
});

test('sanctions proxy rejects a bad IMO with 400 and never calls upstream', async () => {
  let calls = 0;
  const h = mount({
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });
  const res = await h.call('?imo=9169068');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /IMO/);
  assert.equal(calls, 0);
  assert.equal((await h.call('')).status, 400);
});

test('sanctions proxy passes an unknown IMO through as 404', async () => {
  const h = mount({
    fetchImpl: async () => new Response('not found', { status: 404 }),
  });
  const res = await h.call('?imo=9169067');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Unknown IMO number');
});

test('sanctions proxy serves stale cache on 429 and 502 without one', async () => {
  let calls = 0;
  const h = mount({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1)
        return new Response(JSON.stringify(LIVE_CHECK), { status: 200 });
      return new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '120' },
      });
    },
  });
  assert.equal((await h.call('?imo=9169067')).status, 200);
  h.advance(61 * 60 * 1000);
  const stale = await h.call('?imo=9169067');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.sanctionsStatus, 'GREEN');
  // A fresh IMO with no cache behind the rate limit gets a 502, not a retry.
  const blocked = await h.call('?imo=1234567');
  assert.equal(blocked.status, 502);
  assert.match(blocked.body.error, /429/);
});
