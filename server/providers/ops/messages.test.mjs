import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMessagesHandlers } from './messages.js';

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

test('messages POST then GET round-trip', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-msgs-'));
  const storePath = path.join(dir, 'messages.json');
  const api = createMessagesHandlers({
    storePath,
    requireManagerForWrite: async () => false,
  });

  const post = mockRes();
  await api.handler(
    {
      method: 'POST',
      url: '/',
      headers: {},
      socket: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({ from: 'desk-a', text: 'hydrant catalog refreshed' }),
        );
      },
    },
    post,
  );
  assert.equal(post.statusCode, 201);

  const get = mockRes();
  await api.handler(
    { method: 'GET', url: '/', headers: {}, socket: {} },
    get,
  );
  assert.equal(get.statusCode, 200);
  const body = JSON.parse(get.body);
  assert.equal(body.count, 1);
  assert.equal(body.messages[0].text, 'hydrant catalog refreshed');

  await rm(dir, { recursive: true, force: true });
});
