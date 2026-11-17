import test from 'node:test';
import assert from 'node:assert/strict';
import { capeProxy } from './capeProxy.js';

function responseFor(body, type = 'application/json', status = 200) {
  const encoded = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name === 'content-type') return type;
        if (name === 'content-length') return String(encoded.length);
        return null;
      },
    },
    arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
  };
}

function harness(fetchImpl, env) {
  let handler;
  capeProxy({ fetchImpl, env }).configureServer({
    middlewares: {
      use(_route, fn) {
        handler = fn;
      },
    },
  });
  return (method, url) => {
    const res = {
      statusCode: 0,
      headers: {},
      body: null,
      writableEnded: false,
      setHeader(name, value) {
        this.headers[name] = value;
      },
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = { ...this.headers, ...headers };
      },
      end(body) {
        this.body = body;
        this.writableEnded = true;
      },
    };
    const req = { method, url, headers: {}, socket: { remoteAddress: '203.0.113.4' } };
    return handler(req, res).then(() => res);
  };
}

test('the Cape proxy forwards an allowlisted GET and refuses writes and open URLs', async () => {
  const seen = [];
  const call = harness(async (url) => {
    seen.push(url);
    return responseFor(JSON.stringify({ ok: true }));
  }, { CAPE_DISPATCH_URL: 'http://127.0.0.1:8100' });
  {
    const ok = await call('GET', '/api/cad/incidents?limit=5');
    assert.equal(ok.statusCode, 200);
    assert.equal(seen[0], 'http://127.0.0.1:8100/api/cad/incidents?limit=5');
    assert.equal(JSON.parse(ok.body.toString()).ok, true);

    const ingest = await call('POST', '/api/ingest/file');
    assert.equal(ingest.statusCode, 405);
    const hidden = await call('GET', '/api/ingest/file');
    assert.equal(hidden.statusCode, 404);
    const foreign = await call('GET', 'http://evil.example/secret');
    assert.equal(foreign.statusCode, 404);
    assert.equal(seen.length, 1);

    const blocked = harness(async () => {
      throw new Error('must not fetch');
    }, { CAPE_DISPATCH_URL: 'https://capemaydispatch.com' });
    const loop = await blocked('GET', '/api/buoys');
    assert.equal(loop.statusCode, 503);
    assert.equal(seen.length, 1);
  }
});
