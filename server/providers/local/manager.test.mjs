import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createManagerHandler,
} from './manager.js';
import {
  createSessionToken,
  upsertFirebaseAccount,
} from './auth.js';
import {
  admitLlmRequest,
  resetLlmBudget,
} from '../../../src/publicExposure.mjs';

function makeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function makeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = '') {
      this.body = String(chunk || '');
      this.writableEnded = true;
    },
  };
}

test('/manager requires admin auth and controls AI chat switch, settings, layers, and community report approval', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-manager-'));
  const reportDir = path.join(tmpDir, 'community-reports');
  fs.mkdirSync(reportDir, { recursive: true });

  // Seed a pending community report
  const repId = '1730009999-feedbeef';
  fs.writeFileSync(
    path.join(reportDir, `${repId}.json`),
    JSON.stringify({
      id: repId,
      createdAt: '2026-11-09T21:00:00Z',
      category: 'flooding',
      text: 'Floodwater rising at Sunset Blvd and Broadway',
      town: 'West Cape May',
      lat: 38.934,
      lon: -74.928,
      status: 'pending-review',
      visibility: 'private',
      verified: false,
    }),
  );

  try {
    resetLlmBudget();
    const env = {
      GEV_DATA_DIR: tmpDir,
      GEV_REPORT_DIR: reportDir,
      DISPATCH_ADMINS: 'manager@capemaydispatch.com',
      SESSION_SECRET: 'manager-test-secret-0123456789abcdef',
    };
    const handle = createManagerHandler({ env });

    // 1. Unauthenticated GET /manager redirects to /login?next=%2Fmanager
    const anonRes = makeRes();
    assert.equal(await handle(makeReq({ method: 'GET', url: '/manager' }), anonRes), true);
    assert.equal(anonRes.status, 302);
    assert.equal(anonRes.headers.Location, '/login?next=%2Fmanager');

    // 2. Non-admin member gets 403 on /manager and /api/manager/state
    const regularUser = upsertFirebaseAccount(
      {
        uid: 'member-uid-2',
        email: 'visitor@example.com',
        emailVerified: true,
        displayName: 'Visitor',
      },
      env,
    );
    // Force id=2 / non-admin role since first user in empty store gets id=1
    regularUser.id = 2;
    regularUser.role = 'member';
    regularUser.isAdmin = false;
    const memberCookie = `gev_session=${encodeURIComponent(createSessionToken(regularUser, { env }))}`;

    const forbidRes = makeRes();
    await handle(
      makeReq({ method: 'GET', url: '/api/manager/state', headers: { cookie: memberCookie } }),
      forbidRes,
    );
    assert.equal(forbidRes.status, 403);

    // 3. Admin user gets 200 on /manager and /api/manager/state
    const adminUser = upsertFirebaseAccount(
      {
        uid: 'admin-uid-1',
        email: 'manager@capemaydispatch.com',
        emailVerified: true,
        displayName: 'Cape Manager',
      },
      env,
    );
    const adminCookie = `gev_session=${encodeURIComponent(createSessionToken(adminUser, { env }))}`;

    const pageRes = makeRes();
    await handle(
      makeReq({ method: 'GET', url: '/manager', headers: { cookie: adminCookie } }),
      pageRes,
    );
    assert.equal(pageRes.status, 200);
    assert.ok(pageRes.body.includes('Cape May Dispatch · Manager Console'));
    assert.ok(pageRes.body.includes('src="/cape-manager.js"'));

    const stateRes = makeRes();
    await handle(
      makeReq({ method: 'GET', url: '/api/manager/state', headers: { cookie: adminCookie } }),
      stateRes,
    );
    assert.equal(stateRes.status, 200);
    const state = JSON.parse(stateRes.body);
    assert.equal(state.config.aiChatEnabled, true);
    assert.equal(state.reports.length, 1);
    assert.equal(state.reports[0].id, repId);
    assert.equal(state.reports[0].status, 'pending-review');

    // 4. Toggle AI Chat OFF via POST /api/manager/config -> admitLlmRequest refuses immediately
    const offRes = makeRes();
    await handle(
      makeReq({
        method: 'POST',
        url: '/api/manager/config',
        headers: { cookie: adminCookie },
        body: {
          aiChatEnabled: false,
          settings: {
            bannerText: 'High Tide Advisory until 11 PM',
            bannerSeverity: 'warn',
            defaultTown: 'Wildwood',
            reportsOpen: true,
          },
          layers: {
            'predicted-flooding': { enabledByDefault: true, hidden: false },
            satellites: { enabledByDefault: false, hidden: true },
          },
        },
      }),
      offRes,
    );
    assert.equal(offRes.status, 200);
    assert.equal(admitLlmRequest(env).code, 'LLM_DISABLED');

    // Check public /api/local/app-config reflects manager changes
    const pubCfgRes = makeRes();
    await handle(
      makeReq({ method: 'GET', url: '/api/local/app-config', headers: { cookie: adminCookie } }),
      pubCfgRes,
    );
    const pubCfg = JSON.parse(pubCfgRes.body);
    assert.equal(pubCfg.aiChatEnabled, false);
    assert.equal(pubCfg.settings.bannerText, 'High Tide Advisory until 11 PM');
    assert.equal(pubCfg.settings.defaultTown, 'Wildwood');
    assert.equal(pubCfg.layers['predicted-flooding'].enabledByDefault, true);
    assert.equal(pubCfg.layers.satellites.hidden, true);
    assert.equal(pubCfg.auth.authenticated, true);
    assert.equal(pubCfg.auth.user.isAdmin, true);

    // Toggle AI Chat back ON
    const onRes = makeRes();
    await handle(
      makeReq({
        method: 'POST',
        url: '/api/manager/config',
        headers: { cookie: adminCookie },
        body: { aiChatEnabled: true },
      }),
      onRes,
    );
    assert.equal(onRes.status, 200);
    assert.equal(admitLlmRequest(env).ok, true);

    // 5. Approve & Verify community report via POST /api/manager/reports/:id
    const modRes = makeRes();
    await handle(
      makeReq({
        method: 'POST',
        url: `/api/manager/reports/${repId}`,
        headers: { cookie: adminCookie },
        body: { action: 'verify' },
      }),
      modRes,
    );
    assert.equal(modRes.status, 200);
    const modData = JSON.parse(modRes.body);
    assert.equal(modData.report.status, 'approved');
    assert.equal(modData.report.visibility, 'public');
    assert.equal(modData.report.verified, true);
  } finally {
    resetLlmBudget();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
