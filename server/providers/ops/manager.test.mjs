import assert from 'node:assert/strict';
import test from 'node:test';
import {
  managerAllowed,
  tokensMatch,
  resolveManagerToken,
  createManagerHandlers,
} from './manager.js';

test('managerAllowed permits read tools and blocks uploads', () => {
  assert.equal(managerAllowed('status'), true);
  assert.equal(managerAllowed('review/abc'), true);
  assert.equal(managerAllowed('members'), true);
  assert.equal(managerAllowed('uploads'), false);
  assert.equal(managerAllowed('review/../uploads'), false);
  assert.equal(managerAllowed('evidence'), false);
});

test('tokensMatch is length-safe', () => {
  assert.equal(tokensMatch('secret-token', 'secret-token'), true);
  assert.equal(tokensMatch('secret-token', 'secret-tokex'), false);
  assert.equal(tokensMatch('short', 'longer-token'), false);
  assert.equal(tokensMatch('', 'x'), false);
});

test('resolveManagerToken prefers CAPE_MANAGER_TOKEN (legacy)', () => {
  assert.equal(
    resolveManagerToken({
      CAPE_MANAGER_TOKEN: ' a ',
      FIREWIRE_MANAGER_TOKEN: 'b',
    }),
    'a',
  );
  assert.equal(resolveManagerToken({ FIREWIRE_MANAGER_TOKEN: 'b' }), 'b');
  assert.equal(resolveManagerToken({}), null);
});

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk) {
      this.body = chunk == null ? '' : String(chunk);
    },
  };
}

test('session is always configured + authenticated without token', async () => {
  const { sessionHandler } = createManagerHandlers({
    resolveUpstream: () => null,
  });
  const res = mockRes();
  await sessionHandler(
    { method: 'GET', url: '/', headers: {}, socket: {} },
    res,
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.configured, true);
  assert.equal(body.authenticated, true);
  assert.equal(body.mode, 'inapp');
});

test('manager proxy returns in-app quiet stub without FIREWIRE_URL', async () => {
  const { proxyHandler } = createManagerHandlers({
    resolveUpstream: () => null,
  });
  const res = mockRes();
  await proxyHandler(
    { method: 'GET', url: '/queue', headers: {}, socket: {} },
    res,
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.mode, 'inapp');
  assert.equal(body.quiet, true);
  assert.doesNotMatch(res.body, /firewire_unconfigured/);
});
