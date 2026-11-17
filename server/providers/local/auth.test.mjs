import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createAuthHandler,
  verifyFirebaseIdToken,
  upsertFirebaseAccount,
  loadAccountStore,
} from './auth.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const KEY_ID = 'test-firebase-kid-1';

function base64Url(objOrBuf) {
  const buf = Buffer.isBuffer(objOrBuf)
    ? objOrBuf
    : Buffer.from(JSON.stringify(objOrBuf), 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signTestFirebaseJwt(claims = {}, headerOverrides = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: KEY_ID, typ: 'JWT', ...headerOverrides };
  const payload = {
    iss: 'https://securetoken.google.com/cape-dispatch',
    aud: 'cape-dispatch',
    sub: 'firebase-uid-123',
    email: 'resident@capemay.test',
    email_verified: true,
    name: 'Cape Resident',
    iat: nowSec - 10,
    exp: nowSec + 3600,
    firebase: { sign_in_provider: 'google.com' },
    ...claims,
  };
  const unsigned = `${base64Url(header)}.${base64Url(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(privateKey);
  return `${unsigned}.${base64Url(sig)}`;
}

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
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk = '') {
      this.body = String(chunk || '');
      this.writableEnded = true;
    },
  };
}

test('verifyFirebaseIdToken validates cape-dispatch RS256 Google and Apple tokens and rejects bad claims', async () => {
  const certProvider = async () => ({ [KEY_ID]: publicPem });

  const googleToken = signTestFirebaseJwt({
    sub: 'uid-google-1',
    email: 'pilot@capemaydispatch.com',
    firebase: { sign_in_provider: 'google.com' },
  });
  const verifiedGoogle = await verifyFirebaseIdToken(googleToken, { certProvider });
  assert.equal(verifiedGoogle.uid, 'uid-google-1');
  assert.equal(verifiedGoogle.email, 'pilot@capemaydispatch.com');
  assert.equal(verifiedGoogle.provider, 'google');

  const appleToken = signTestFirebaseJwt({
    sub: 'uid-apple-9',
    email: 'privaterelay@appleid.com',
    firebase: { sign_in_provider: 'apple.com' },
  });
  const verifiedApple = await verifyFirebaseIdToken(appleToken, { certProvider });
  assert.equal(verifiedApple.uid, 'uid-apple-9');
  assert.equal(verifiedApple.provider, 'apple');

  const wrongProject = signTestFirebaseJwt({ aud: 'other-project' });
  await assert.rejects(
    () => verifyFirebaseIdToken(wrongProject, { certProvider }),
    /Invalid Firebase token audience/,
  );

  const expired = signTestFirebaseJwt({ exp: Math.floor(Date.now() / 1000) - 120 });
  await assert.rejects(
    () => verifyFirebaseIdToken(expired, { certProvider }),
    /Firebase token has expired/,
  );
});

test('legacy SQLite members table accounts are preserved with same username, role, and tier', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-auth-sqlite-'));
  try {
    const dbPath = path.join(tmpDir, 'cape_dispatch.db');
    const sqlite = process.getBuiltinModule?.('node:sqlite');
    if (sqlite?.DatabaseSync) {
      const db = new sqlite.DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT DEFAULT '',
          display_name TEXT DEFAULT '',
          avatar_url TEXT DEFAULT '',
          tier TEXT DEFAULT 'free',
          role TEXT DEFAULT 'member',
          firebase_uid TEXT DEFAULT NULL,
          auth_provider TEXT DEFAULT 'local',
          created_at TEXT
        );
        INSERT INTO members (id, username, email, display_name, tier, role, firebase_uid, auth_provider)
        VALUES (7, 'captain_may', 'captain@capemay.org', 'Captain May', 'founder', 'trusted', 'legacy-uid-7', 'google');
      `);
      db.close();

      const env = {
        GEV_DATA_DIR: path.join(tmpDir, '.gev-data'),
        CAPE_DISPATCH_DB_PATH: dbPath,
        DISPATCH_ADMINS: 'willmac1wm',
      };
      const store = loadAccountStore(env);
      assert.equal(store.accounts.length, 1);
      assert.equal(store.accounts[0].username, 'captain_may');
      assert.equal(store.accounts[0].role, 'trusted');
      assert.equal(store.accounts[0].tier, 'founder');

      // Signing in with matching email links/preserves the same account
      const user = upsertFirebaseAccount(
        {
          uid: 'legacy-uid-7',
          email: 'captain@capemay.org',
          emailVerified: true,
          displayName: 'Captain May',
          provider: 'google',
        },
        env,
      );
      assert.equal(user.id, 7);
      assert.equal(user.username, 'captain_may');
      assert.equal(user.role, 'trusted');
      assert.equal(user.tier, 'founder');
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('POST /api/auth/firebase issues session cookie, GET /api/auth/me reads it, and POST /api/auth/delete-account removes account', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-auth-flow-'));
  try {
    const env = {
      GEV_DATA_DIR: tmpDir,
      FIREBASE_PROJECT_ID: 'cape-dispatch',
      FIREBASE_WEB_API_KEY: 'AIzaTestKeyForClientConfig',
      DISPATCH_ADMINS: 'chief@capemaydispatch.com',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    };
    const handle = createAuthHandler({
      env,
      certProvider: async () => ({ [KEY_ID]: publicPem }),
    });

    // 1. Check /api/auth/firebase-config
    const cfgRes = makeRes();
    assert.equal(
      await handle(makeReq({ method: 'GET', url: '/api/auth/firebase-config' }), cfgRes),
      true,
    );
    const cfg = JSON.parse(cfgRes.body);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.projectId, 'cape-dispatch');

    // 2. Sign in via POST /api/auth/firebase
    const idToken = signTestFirebaseJwt({
      sub: 'chief-uid-1',
      email: 'chief@capemaydispatch.com',
      name: 'Dispatch Chief',
      firebase: { sign_in_provider: 'apple.com' },
    });
    const loginRes = makeRes();
    await handle(
      makeReq({
        method: 'POST',
        url: '/api/auth/firebase',
        body: { id_token: idToken },
      }),
      loginRes,
    );
    assert.equal(loginRes.status, 200);
    const loginData = JSON.parse(loginRes.body);
    assert.equal(loginData.ok, true);
    assert.equal(loginData.user.isAdmin, true);
    assert.equal(loginData.user.role, 'admin');
    assert.equal(loginData.user.authProvider, 'apple');

    const cookieHeader = String(loginRes.headers['Set-Cookie'] || '').split(';')[0];
    assert.ok(cookieHeader.startsWith('gev_session='));

    // 3. Verify GET /api/auth/me returns the signed-in admin
    const meRes = makeRes();
    await handle(
      makeReq({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieHeader },
      }),
      meRes,
    );
    const meData = JSON.parse(meRes.body);
    assert.equal(meData.authenticated, true);
    assert.equal(meData.user.email, 'chief@capemaydispatch.com');
    assert.equal(meData.user.isAdmin, true);

    // 4. Verify GET /login renders Google and Apple sign-in without inline scripts
    const pageRes = makeRes();
    await handle(makeReq({ method: 'GET', url: '/login' }), pageRes);
    assert.equal(pageRes.status, 200);
    assert.ok(pageRes.body.includes('Continue with Google'));
    assert.ok(pageRes.body.includes('Continue with Apple'));
    assert.ok(pageRes.body.includes('src="/cape-auth.js"'));

    // 5. Self-service account deletion via POST /api/auth/delete-account
    const delRes = makeRes();
    await handle(
      makeReq({
        method: 'POST',
        url: '/api/auth/delete-account',
        headers: { cookie: cookieHeader },
      }),
      delRes,
    );
    assert.equal(delRes.status, 200);
    assert.equal(JSON.parse(delRes.body).deleted, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
