import assert from 'node:assert/strict';
import test from 'node:test';
import { createCapeMiddleware } from './cape.js';
import { quietCapePayload, quietManagerPayload } from './capeQuietStore.js';

test('quietCapePayload returns empty-tolerant radio/CAD shapes', () => {
  assert.deepEqual(quietCapePayload('radio/feeds').feeds, []);
  assert.deepEqual(quietCapePayload('cad/incidents').incidents, []);
  assert.equal(quietCapePayload('health/sources').mode, 'inapp');
  assert.equal(quietCapePayload('fw-audio/x.mp3'), null);
});

test('quietManagerPayload is in-app stub', () => {
  const body = quietManagerPayload('queue');
  assert.equal(body.mode, 'inapp');
  assert.equal(body.quiet, true);
  assert.equal(body.tool, 'queue');
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

test('createCapeMiddleware serves quiet 200 without FIREWIRE_URL', async () => {
  const mw = createCapeMiddleware({ baseUrl: '' });
  const res = mockRes();
  await mw({ method: 'GET', url: '/radio/feeds' }, res, () => {
    throw new Error('next should not run');
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-Cape-Mode'], 'inapp-quiet');
  const body = JSON.parse(res.body);
  assert.deepEqual(body.feeds, []);
  assert.equal(body.mode, 'inapp');
});

test('createCapeMiddleware never returns firewire_unconfigured', async () => {
  const mw = createCapeMiddleware({ baseUrl: null });
  const res = mockRes();
  await mw({ method: 'GET', url: '/cad/incidents' }, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /firewire_unconfigured/);
});
