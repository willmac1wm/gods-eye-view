import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManagerConfigHandlers } from './managerConfig.js';

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

test('manager config GET and PUT are ungated (no CAPE_MANAGER_TOKEN)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gev-mgr-cfg-'));
  const storePath = path.join(dir, 'config.json');
  const api = createManagerConfigHandlers({ storePath });

  const getRes = mockRes();
  await api.handler(
    { method: 'GET', url: '/', headers: {}, socket: {} },
    getRes,
  );
  assert.equal(getRes.statusCode, 200);
  const got = JSON.parse(getRes.body);
  assert.equal(got.ok, true);
  assert.equal(got.config.viewability.place, true);

  const ok = mockRes();
  await api.handler(
    {
      method: 'PUT',
      url: '/',
      headers: {},
      socket: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(
          JSON.stringify({
            viewability: { social: false },
            intervalsMs: { social: 45_000 },
          }),
        );
      },
    },
    ok,
  );
  assert.equal(ok.statusCode, 200);
  const saved = JSON.parse(ok.body);
  assert.equal(saved.config.viewability.social, false);
  assert.equal(saved.config.intervalsMs.social, 45_000);

  const again = await api.getConfig();
  assert.equal(again.viewability.social, false);

  await rm(dir, { recursive: true, force: true });
});
