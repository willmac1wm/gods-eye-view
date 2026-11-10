/**
 * Public-launch security regressions for Cloudflare Tunnel cutover.
 *
 * Behind cloudflared every visitor arrives as 127.0.0.1 with CF headers.
 * Cost-bearing and operator surfaces must refuse that traffic; keyless local
 * read APIs may stay open for same-site app use.
 */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { admitSameSite } from '../server/providers/common/same-site.js';
import { isLocalMcpRequest } from '../server/mcp/plugin.js';
import { admitKeySetupRequest } from './keySetupCore.mjs';
import { openAiRealtimeProxy } from '../server/providers/openai.js';
import { createGeminiTokenHandler } from '../server/providers/gemini/realtime.js';
import { createOpenAiChatHandler } from '../server/providers/openai/chat.js';

const CF_HEADERS = {
  'cf-connecting-ip': '203.0.113.50',
  'cf-ray': '9abcdef012345678-EWR',
  'x-forwarded-for': '203.0.113.50',
  'x-forwarded-proto': 'https',
};

function install(plugin) {
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
    httpServer: { once() {} },
  });
  return routes;
}

function request(
  handler,
  {
    method = 'GET',
    url = '/',
    body = '',
    headers = {},
    remoteAddress = '127.0.0.1',
  } = {},
) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    Object.assign(req, {
      method,
      url,
      headers: {
        host: 'localhost:4173',
        origin: 'http://localhost:4173',
        'content-type': 'application/json',
        ...headers,
      },
      socket: { remoteAddress },
      aborted: false,
    });
    const out = {};
    const res = {
      statusCode: 200,
      destroyed: false,
      writableEnded: false,
      setHeader(name, value) {
        out[name.toLowerCase()] = value;
      },
      end(payload = '') {
        this.writableEnded = true;
        resolve({
          status: this.statusCode,
          headers: out,
          body: String(payload),
          json: () => JSON.parse(String(payload || '{}')),
        });
      },
      once() {},
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('sameSiteGated refuses Cloudflare Tunnel traffic on loopback sockets', () => {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
  const refused = admitSameSite(
    {
      headers: {
        host: 'localhost:4173',
        origin: 'http://localhost:4173',
        'sec-fetch-site': 'same-origin',
        ...CF_HEADERS,
      },
      socket: { remoteAddress: '127.0.0.1' },
    },
    res,
  );
  assert.equal(refused, true);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, 'Proxied requests are not accepted');
});

test('Realtime token mint refuses CF tunnel headers even on 127.0.0.1', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('proxied realtime must not call OpenAI');
  });
  const handler = install(openAiRealtimeProxy({})).get('/api/realtime/token');
  const response = await request(handler, {
    headers: {
      ...CF_HEADERS,
      host: 'capemaydispatch.com',
      origin: 'https://capemaydispatch.com',
    },
  });
  assert.equal(response.status, 403);
  assert.match(response.body, /proxy|tunnel|Proxied/i);
  assert.equal(response.body.includes('sk-'), false);
});

test('Realtime OAuth status refuses CF tunnel traffic that looks local', async () => {
  const handler = install(openAiRealtimeProxy({})).get(
    '/api/realtime/oauth-status',
  );
  const response = await request(handler, {
    headers: { ...CF_HEADERS },
  });
  assert.equal(response.status, 403);
  // sameSiteGated answers first; handler defense-in-depth keeps available:false
  // when reached without the outer gate.
  assert.match(response.body, /Proxied|only from this machine/i);
  assert.notEqual(response.json().available, true);
});

test('Gemini Live token refuses CF tunnel traffic', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('proxied gemini must not mint tokens');
  });
  process.env.GEMINI_API_KEY = 'fixture-gemini-secret';
  t.after(() => {
    delete process.env.GEMINI_API_KEY;
  });
  const response = await request(createGeminiTokenHandler(), {
    method: 'POST',
    body: '{}',
    headers: {
      ...CF_HEADERS,
      host: 'capemaydispatch.com',
      origin: 'https://capemaydispatch.com',
    },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.includes('fixture-gemini-secret'), false);
});

test('OpenAI chat refuses CF tunnel traffic', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('proxied openai chat must not spend quota');
  });
  process.env.OPENAI_API_KEY = 'fixture-openai-secret';
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });
  const response = await request(createOpenAiChatHandler({}), {
    method: 'POST',
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
    }),
    headers: {
      ...CF_HEADERS,
      host: 'capemaydispatch.com',
      origin: 'https://capemaydispatch.com',
    },
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.includes('fixture-openai-secret'), false);
});

test('MCP admits only true local requests without proxy headers', () => {
  assert.equal(
    isLocalMcpRequest({
      remoteAddress: '127.0.0.1',
      localPort: 4173,
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      headers: {},
      env: {},
    }),
    true,
  );
  assert.equal(
    isLocalMcpRequest({
      remoteAddress: '127.0.0.1',
      localPort: 4173,
      host: '127.0.0.1:4173',
      origin: 'http://127.0.0.1:4173',
      headers: CF_HEADERS,
      env: {},
    }),
    false,
  );
});

test('Provider Settings refuses Cloudflare Tunnel and public Host', () => {
  const proxied = admitKeySetupRequest({
    method: 'GET',
    remoteAddress: '127.0.0.1',
    hostHeader: 'localhost:4173',
    protocol: 'http:',
    origin: 'http://localhost:4173',
    proxyHeaders: CF_HEADERS,
    env: {},
  });
  assert.equal(proxied.ok, false);
  assert.equal(proxied.status, 403);
  assert.equal(proxied.code, 'proxied');

  const publicHost = admitKeySetupRequest({
    method: 'GET',
    remoteAddress: '127.0.0.1',
    hostHeader: 'capemaydispatch.com',
    protocol: 'https:',
    origin: 'https://capemaydispatch.com',
    proxyHeaders: {},
    env: {},
  });
  assert.equal(publicHost.ok, false);
  assert.equal(publicHost.status, 403);
});
