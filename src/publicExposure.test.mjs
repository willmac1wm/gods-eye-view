import test from 'node:test';
import assert from 'node:assert/strict';
import { admitKeySetupRequest } from './keySetupCore.mjs';
import { clientKey } from '../server/providers/common/rate-limit.js';
import { retireLegacyServiceWorkers } from './legacyServiceWorker.js';
import {
  admitLlmRequest,
  capeDispatchOrigin,
  capeQueryAllowed,
  capeUpstreamPath,
  clientAddress,
  isPublicIp,
  noteLlmUsage,
  reportHoneypotTripped,
  resetLlmBudget,
  resolveLocalUpstream,
  sanitizeReportText,
  tokensEqual,
} from './publicExposure.mjs';

const localSetup = {
  method: 'POST',
  remoteAddress: '127.0.0.1',
  hostHeader: 'localhost:4173',
  origin: 'http://localhost:4173',
  contentType: 'application/json',
};

test('public mode refuses key setup even from a loopback socket with a local Host', () => {
  const refused = admitKeySetupRequest({
    ...localSetup,
    env: { GEV_PUBLIC: '1' },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'public');
  assert.equal(
    admitKeySetupRequest({
      ...localSetup,
      env: { GEV_PUBLIC: '1' },
      proxyHeaders: { 'cf-connecting-ip': '127.0.0.1' },
    }).code,
    'public',
  );
  assert.equal(
    admitKeySetupRequest({
      ...localSetup,
      env: { GEV_PUBLIC: '1' },
      proxyHeaders: { 'x-forwarded-for': '127.0.0.1' },
    }).code,
    'public',
  );
});

test('the admin listener still requires a token and ignores forwarded addresses', () => {
  const env = {
    GEV_PUBLIC: '1',
    GEV_ADMIN_ENABLED: '1',
    GEV_ADMIN_TOKEN: 'a'.repeat(32),
  };
  assert.equal(
    admitKeySetupRequest({ ...localSetup, env, adminListener: true, adminToken: 'nope' }).code,
    'admin-token',
  );
  assert.equal(
    admitKeySetupRequest({
      ...localSetup,
      env,
      adminListener: true,
      adminToken: env.GEV_ADMIN_TOKEN,
      proxyHeaders: { 'cf-connecting-ip': '203.0.113.8' },
    }).code,
    'proxied',
  );
  assert.equal(
    admitKeySetupRequest({
      ...localSetup,
      env,
      adminListener: true,
      adminToken: env.GEV_ADMIN_TOKEN,
      remoteAddress: '203.0.113.8',
    }).code,
    'not-loopback',
  );
  assert.equal(
    admitKeySetupRequest({
      ...localSetup,
      env,
      adminListener: true,
      adminToken: env.GEV_ADMIN_TOKEN,
    }).ok,
    true,
  );
  assert.equal(tokensEqual('a'.repeat(32), 'a'.repeat(31) + 'b'), false);
});

test('CF-Connecting-IP is a rate-limit identity only for a public tunnel, never a privilege', () => {
  const env = { GEV_PUBLIC: '1' };
  const tunneled = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.2' },
  };
  assert.equal(clientAddress(tunneled, env), '203.0.113.9');
  assert.equal(
    clientAddress(
      {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '127.0.0.1' },
      },
      env,
    ),
    'tunnel',
  );
  assert.equal(
    clientAddress(
      {
        socket: { remoteAddress: '192.168.1.20' },
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      },
      env,
    ),
    '192.168.1.20',
  );
  assert.equal(clientKey({ socket: { remoteAddress: '10.0.0.5' } }), '10.0.0.5');
  assert.equal(isPublicIp('10.1.1.1'), false);
  assert.equal(isPublicIp('203.0.113.9'), true);
});

test('Cape Dispatch upstream stays on a local origin and only read paths', () => {
  assert.equal(capeDispatchOrigin({}).origin, 'http://127.0.0.1:8100');
  assert.equal(capeDispatchOrigin({ CAPE_DISPATCH_URL: 'http://localhost:8100' }).ok, true);
  assert.equal(
    capeDispatchOrigin({ CAPE_DISPATCH_URL: 'https://capemaydispatch.com' }).ok,
    false,
  );
  assert.equal(resolveLocalUpstream('http://169.254.169.254/').ok, false);
  assert.equal(resolveLocalUpstream('https://evil.example/api').ok, false);
  assert.equal(capeUpstreamPath('GET', '/api/cape/api/cad/incidents'), '/api/cad/incidents');
  assert.equal(capeUpstreamPath('GET', '/api/cad/incidents'), '/api/cad/incidents');
  assert.equal(capeUpstreamPath('GET', '/api/cape/fw-audio/clip_1.mp3'), '/fw-audio/clip_1.mp3');
  assert.equal(capeUpstreamPath('GET', '/api/cape/api/flood_map/tiles/1'), '/api/flood_map/tiles/1');
  assert.equal(capeUpstreamPath('POST', '/api/cape/api/ingest/file'), null);
  assert.equal(capeUpstreamPath('GET', '/api/cape/api/ingest/file'), null);
  assert.equal(capeUpstreamPath('GET', '/api/cape/api/cad/incidents/../../etc/passwd'), null);
  assert.equal(capeQueryAllowed('?limit=60'), true);
  assert.equal(capeQueryAllowed('?next=http://evil'), false);
});

test('LLM kill switch and daily caps stop chat and voice spend', () => {
  resetLlmBudget();
  assert.equal(admitLlmRequest({ GEV_LLM_DISABLED: '1' }).code, 'LLM_DISABLED');
  resetLlmBudget();
  const env = { GEV_PUBLIC: '1', GEV_LLM_DAILY_REQUEST_CAP: '2', GEV_LLM_DAILY_USD_CAP: '0', GEV_LLM_DAILY_TOKEN_CAP: '0' };
  assert.equal(admitLlmRequest(env).ok, true);
  assert.equal(admitLlmRequest(env).ok, true);
  assert.equal(admitLlmRequest(env).code, 'DAILY_REQUEST_CAP');
  resetLlmBudget();
  const tokens = { GEV_PUBLIC: '1', GEV_LLM_DAILY_REQUEST_CAP: '0', GEV_LLM_DAILY_USD_CAP: '0', GEV_LLM_DAILY_TOKEN_CAP: '10' };
  assert.equal(admitLlmRequest(tokens).ok, true);
  noteLlmUsage(10, tokens);
  assert.equal(admitLlmRequest(tokens).code, 'DAILY_TOKEN_CAP');
  resetLlmBudget();
});

test('community report text is sanitized and the honeypot is recognized', () => {
  assert.equal(sanitizeReportText('  <script>alert(1)</script>  water  '), 'scriptalert(1)/script water');
  assert.equal(reportHoneypotTripped({ gev_hp: 'http://spam' }), true);
  assert.equal(reportHoneypotTripped({ text: 'water on the road' }), false);
});

test('legacy service workers on this origin are unregistered', async () => {
  const calls = [];
  await retireLegacyServiceWorkers({
    serviceWorker: {
      getRegistrations: async () => [{ unregister: () => { calls.push('a'); return true; } }],
    },
  });
  assert.deepEqual(calls, ['a']);
});
