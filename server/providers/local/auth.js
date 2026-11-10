/**
 * Google & Apple Sign-In for Cape May Dispatch (Firebase project `cape-dispatch`).
 *
 * Keeps the same user accounts and roles from the legacy cape-dispatch app:
 *   1. Verifies Firebase ID tokens (RS256 JWTs issued by
 *      `https://securetoken.google.com/cape-dispatch` for audience `cape-dispatch`)
 *      against Google's X.509 public certificates using `node:crypto`.
 *   2. Imports & syncs existing accounts from the legacy SQLite `members` table
 *      (`CAPE_DISPATCH_DB_PATH` or `C:\cape-dispatch\cape_dispatch.db`) via
 *      `node:sqlite` when present, and persists all accounts in
 *      `.gev-data/cape-accounts.json`.
 *   3. Preserves account roles (`member`, `trusted`, `master`, `admin`), `tier`,
 *      and `DISPATCH_ADMINS` / `GEV_ADMIN_EMAILS` elevation.
 *   4. Serves `/login`, `/account`, `/auth/google`, `/auth/apple`, `/logout`,
 *      and `/api/auth/{firebase-config,firebase,me,logout,delete-account}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BROWSER_HEADERS } from '../../../build/vite.js';
import { isPublicExposure } from '../../../src/publicExposure.mjs';
import { makeRateLimiter } from '../../../src/sources/rateLimit.js';
import { clientKey } from '../common/rate-limit.js';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const DEFAULT_FIREBASE_PROJECT_ID = 'cape-dispatch';
const DEFAULT_FIREBASE_AUTH_DOMAIN = 'cape-dispatch.firebaseapp.com';
const SESSION_COOKIE_NAME = 'gev_session';
const SESSION_MAX_AGE_SEC = 30 * 24 * 3600; // 30 days

let cachedCerts = { expiresAt: 0, certs: null };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function base64UrlDecode(str) {
  const normalized = String(str || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function firebaseClientConfig(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_PROJECT_ID).trim();
  const authDomain = String(env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com` || DEFAULT_FIREBASE_AUTH_DOMAIN).trim();
  const apiKey = String(env.FIREBASE_WEB_API_KEY || '').trim();
  const appId = String(env.FIREBASE_APP_ID || '').trim();
  return {
    enabled: Boolean(apiKey),
    apiKey,
    authDomain,
    projectId,
    appId,
  };
}

async function fetchGooglePublicCerts(fetchImpl = fetch, now = Date.now) {
  if (cachedCerts.certs && now() < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }
  const response = await fetchImpl(GOOGLE_CERTS_URL, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch Firebase public certificates (${response.status})`);
  }
  const certs = await response.json();
  const cc = String(response.headers?.get?.('cache-control') || '');
  const maxAgeMatch = /max-age=(\d+)/i.exec(cc);
  const ttlMs = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]) * 1000, 6 * 3600e3) : 3600e3;
  cachedCerts = {
    certs,
    expiresAt: now() + ttlMs,
  };
  return certs;
}

/**
 * Verify a Firebase ID token (RS256 JWT) for project `cape-dispatch`.
 */
export async function verifyFirebaseIdToken(
  idToken,
  {
    env = process.env,
    fetchImpl = fetch,
    certProvider = null,
    now = Date.now,
  } = {},
) {
  const raw = String(idToken || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch {
    throw new Error('Invalid Firebase ID token encoding');
  }
  if (header?.alg !== 'RS256' || typeof header?.kid !== 'string' || !header.kid) {
    throw new Error('Unsupported Firebase token header');
  }

  const { projectId } = firebaseClientConfig(env);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(now() / 1000);

  if (payload?.iss !== expectedIssuer) {
    throw new Error('Invalid Firebase token issuer');
  }
  if (payload?.aud !== projectId) {
    throw new Error('Invalid Firebase token audience');
  }
  if (typeof payload?.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Invalid Firebase token subject');
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= nowSec - 30) {
    throw new Error('Firebase token has expired');
  }
  if (typeof payload?.iat !== 'number' || payload.iat > nowSec + 60) {
    throw new Error('Firebase token issued-at time is invalid');
  }

  const certs = certProvider
    ? await certProvider()
    : await fetchGooglePublicCerts(fetchImpl, now);
  const certOrKey = certs?.[header.kid];
  if (!certOrKey) {
    throw new Error('Unknown Firebase signing key ID');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const signature = base64UrlDecode(parts[2]);
  if (!verifier.verify(certOrKey, signature)) {
    throw new Error('Firebase token signature verification failed');
  }

  const signInProvider = String(
    payload?.firebase?.sign_in_provider || 'firebase',
  ).toLowerCase();
  const providerLabel = signInProvider.includes('apple')
    ? 'apple'
    : signInProvider.includes('google')
      ? 'google'
      : 'firebase';

  return {
    uid: payload.sub.trim(),
    email: String(payload.email || '').trim().toLowerCase(),
    emailVerified: payload.email_verified !== false,
    displayName: String(payload.name || '').trim(),
    avatarUrl: String(payload.picture || '').trim(),
    provider: providerLabel,
  };
}

function adminAllowlist(env = process.env) {
  const raw = [env.DISPATCH_ADMINS, env.GEV_ADMIN_EMAILS]
    .filter(Boolean)
    .join(',');
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isUserAdmin(user, env = process.env) {
  if (!user) return false;
  if (user.role === 'admin' || user.id === 1) return true;
  const admins = adminAllowlist(env);
  if (user.username && admins.has(String(user.username).toLowerCase())) return true;
  if (user.email && admins.has(String(user.email).toLowerCase())) return true;
  return false;
}

function defaultDataDir(env = process.env) {
  return env.GEV_DATA_DIR
    ? path.resolve(env.GEV_DATA_DIR)
    : path.join(process.cwd(), '.gev-data');
}

function sessionSecret(env = process.env) {
  const configured = String(env.SESSION_SECRET || env.GEV_SESSION_SECRET || '').trim();
  if (configured.length >= 16) return configured;
  const dir = defaultDataDir(env);
  const file = path.join(dir, 'session-secret.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* generate new */
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
  } catch {
    /* ephemeral fallback if dir is read-only */
  }
  return generated;
}

export function createSessionToken(user, { env = process.env, now = Date.now } = {}) {
  const exp = Math.floor(now() / 1000) + SESSION_MAX_AGE_SEC;
  const body = base64UrlEncode(
    JSON.stringify({
      uid: user.firebaseUid || null,
      id: user.id,
      username: user.username,
      email: user.email || '',
      role: isUserAdmin(user, env) ? 'admin' : user.role || 'member',
      exp,
    }),
  );
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', sessionSecret(env)).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifySessionToken(token, { env = process.env, now = Date.now } = {}) {
  const raw = String(token || '').trim();
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', sessionSecret(env)).update(body).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(base64UrlDecode(body).toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp <= Math.floor(now() / 1000)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function legacySqliteCandidates(env = process.env) {
  const candidates = [];
  if (env.CAPE_DISPATCH_DB_PATH) candidates.push(path.resolve(env.CAPE_DISPATCH_DB_PATH));
  candidates.push('C:\\cape-dispatch\\cape_dispatch.db');
  candidates.push(path.resolve(process.cwd(), '..', 'cape-dispatch', 'cape_dispatch.db'));
  return candidates;
}

/**
 * Load accounts from `.gev-data/cape-accounts.json` and merge any existing
 * rows from the legacy SQLite `members` table so no user loses their account.
 */
export function loadAccountStore(env = process.env) {
  const dir = defaultDataDir(env);
  const file = path.join(dir, 'cape-accounts.json');
  let store = { nextId: 1, accounts: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw?.accounts)) {
      store = {
        nextId: Number(raw.nextId) || raw.accounts.length + 1,
        accounts: raw.accounts,
      };
    }
  } catch {
    /* start fresh */
  }

  // Import from legacy SQLite `members` table if available and not yet imported.
  for (const dbPath of legacySqliteCandidates(env)) {
    try {
      if (!fs.existsSync(dbPath)) continue;
      // Dynamic import pattern or synchronous require via process.getBuiltinModule
      const sqlite = process.getBuiltinModule?.('node:sqlite');
      if (!sqlite?.DatabaseSync) break;
      const db = new sqlite.DatabaseSync(dbPath, { open: true, readOnly: true });
      try {
        const rows = db
          .prepare(
            `SELECT id, username, email, display_name, avatar_url, tier, role, firebase_uid, auth_provider, created_at
             FROM members ORDER BY id ASC`,
          )
          .all();
        for (const r of rows) {
          const existing = store.accounts.find(
            (a) =>
              (r.firebase_uid && a.firebaseUid === r.firebase_uid) ||
              (r.email && a.email && a.email.toLowerCase() === String(r.email).toLowerCase()) ||
              (r.username && a.username && a.username.toLowerCase() === String(r.username).toLowerCase()),
          );
          if (!existing) {
            const id = Number(r.id) || store.nextId++;
            if (id >= store.nextId) store.nextId = id + 1;
            store.accounts.push({
              id,
              username: String(r.username || '').trim(),
              email: String(r.email || '').trim().toLowerCase(),
              displayName: String(r.display_name || r.username || '').trim(),
              avatarUrl: String(r.avatar_url || '').trim(),
              tier: String(r.tier || 'free'),
              role: String(r.role || 'member'),
              firebaseUid: r.firebase_uid ? String(r.firebase_uid).trim() : null,
              authProvider: String(r.auth_provider || 'local'),
              createdAt: r.created_at || new Date().toISOString(),
            });
          }
        }
      } finally {
        db.close();
      }
      break;
    } catch {
      /* ignore unreadable legacy DB */
    }
  }

  return store;
}

export function saveAccountStore(store, env = process.env) {
  const dir = defaultDataDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cape-accounts.json'), JSON.stringify(store, null, 2));
}

function sanitizeUsernameBase(str) {
  const cleaned = String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : 'dispatch_user';
}

function uniqueUsername(store, preferred) {
  const base = sanitizeUsernameBase(preferred);
  const taken = new Set(store.accounts.map((a) => String(a.username || '').toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base.slice(0, 19)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 16)}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Find or create a Cape May Dispatch account for a verified Firebase user,
 * preserving existing usernames, roles, and admin privileges.
 */
export function upsertFirebaseAccount(profile, env = process.env) {
  const store = loadAccountStore(env);
  const uid = String(profile.uid || '').trim();
  const email = String(profile.email || '').trim().toLowerCase();

  let account = store.accounts.find((a) => a.firebaseUid && a.firebaseUid === uid);
  if (!account && email && profile.emailVerified !== false) {
    account = store.accounts.find(
      (a) => a.email && a.email.toLowerCase() === email,
    );
  }

  if (account) {
    account.firebaseUid = uid;
    if (email && !account.email) account.email = email;
    if (profile.displayName && !account.displayName) {
      account.displayName = profile.displayName.slice(0, 80);
    }
    if (profile.avatarUrl) {
      account.avatarUrl = profile.avatarUrl.slice(0, 500);
    }
    if (profile.provider) {
      account.authProvider = profile.provider;
    }
    account.lastLoginAt = new Date().toISOString();
    if (isUserAdmin(account, env)) {
      account.role = 'admin';
    }
  } else {
    const id = store.nextId++;
    const preferredUsername =
      (email ? email.split('@')[0] : '') ||
      profile.displayName ||
      `${profile.provider || 'user'}_${uid.slice(0, 8)}`;
    const username = uniqueUsername(store, preferredUsername);
    account = {
      id,
      username,
      email,
      displayName: (profile.displayName || username).slice(0, 80),
      avatarUrl: String(profile.avatarUrl || '').slice(0, 500),
      tier: 'free',
      role: id === 1 ? 'admin' : 'member',
      firebaseUid: uid,
      authProvider: profile.provider || 'firebase',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    if (isUserAdmin(account, env)) {
      account.role = 'admin';
    }
    store.accounts.push(account);
  }

  saveAccountStore(store, env);
  return formatPublicUser(account, env);
}

export function formatPublicUser(account, env = process.env) {
  if (!account) return null;
  const admin = isUserAdmin(account, env);
  return {
    id: account.id,
    username: account.username,
    email: account.email || '',
    displayName: account.displayName || account.username,
    avatarUrl: account.avatarUrl || '',
    tier: account.tier || 'free',
    role: admin ? 'admin' : account.role || 'member',
    isAdmin: admin,
    authProvider: account.authProvider || 'firebase',
  };
}

export function getSessionUser(req, { env = process.env, now = Date.now } = {}) {
  const cookies = parseCookies(req?.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = verifySessionToken(token, { env, now });
  if (!session) return null;

  const store = loadAccountStore(env);
  const account = store.accounts.find(
    (a) =>
      (session.uid && a.firebaseUid === session.uid) ||
      (session.id && a.id === session.id) ||
      (session.username && a.username === session.username),
  );
  if (account) return formatPublicUser(account, env);
  return formatPublicUser(
    {
      id: session.id,
      username: session.username,
      email: session.email,
      displayName: session.username,
      role: session.role,
      firebaseUid: session.uid,
    },
    env,
  );
}

export function deleteAccountForUser(user, env = process.env) {
  if (!user) return false;
  const store = loadAccountStore(env);
  const before = store.accounts.length;
  store.accounts = store.accounts.filter(
    (a) =>
      !(
        (user.id && a.id === user.id) ||
        (user.username && a.username === user.username) ||
        (user.email && a.email && a.email.toLowerCase() === String(user.email).toLowerCase())
      ),
  );
  saveAccountStore(store, env);
  return store.accounts.length < before;
}

function buildSessionCookie(token, { env = process.env, clear = false } = {}) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : SESSION_MAX_AGE_SEC}`,
  ];
  if (isPublicExposure(env)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function renderAuthPageHtml({ user = null, nextUrl = '/', autoProvider = null, env = process.env } = {}) {
  const safeNext = String(nextUrl || '/').startsWith('/') && !String(nextUrl || '/').startsWith('//')
    ? String(nextUrl)
    : '/';
  const cfg = firebaseClientConfig(env);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e17">
<title>${user ? 'Your Account' : 'Sign In'} — Cape May Dispatch</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<style>
  :root {
    --bg: #0a0e17;
    --panel: #111827;
    --border: #1f2937;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --accent: #38bdf8;
    --danger: #f87171;
    --ok: #34d399;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
  }
  .wrap {
    max-width: 480px;
    margin: 0 auto;
    padding: 40px 20px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    font-size: 1.1rem;
    margin-bottom: 24px;
  }
  .brand-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 24px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  }
  h1 {
    margin: 0 0 6px;
    font-size: 1.45rem;
  }
  .sub {
    color: var(--muted);
    font-size: 0.92rem;
    margin-bottom: 22px;
  }
  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: #1f2937;
    color: var(--text);
    font-size: 0.96rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    margin-bottom: 12px;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn:hover {
    background: #273548;
    border-color: var(--accent);
  }
  .btn-google {
    background: #ffffff;
    color: #111827;
    border-color: #d1d5db;
  }
  .btn-google:hover {
    background: #f3f4f6;
  }
  .btn-apple {
    background: #000000;
    color: #ffffff;
    border-color: #374151;
  }
  .btn-apple:hover {
    background: #18181b;
  }
  .btn-primary {
    background: #0284c7;
    color: #fff;
    border-color: #38bdf8;
  }
  .btn-danger {
    background: rgba(248, 113, 113, 0.12);
    color: var(--danger);
    border-color: rgba(248, 113, 113, 0.35);
    margin-top: 16px;
  }
  .status-msg {
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 0.88rem;
    margin-bottom: 14px;
    display: none;
  }
  .status-msg.error {
    display: block;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.4);
    color: #fca5a5;
  }
  .status-msg.ok {
    display: block;
    background: rgba(52, 211, 153, 0.12);
    border: 1px solid rgba(52, 211, 153, 0.4);
    color: #6ee7b7;
  }
  .profile-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255,255,255,0.03);
    border-radius: 10px;
    margin-bottom: 18px;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    background: rgba(56, 189, 248, 0.15);
    color: var(--accent);
  }
  .links {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
  }
  .links a { color: var(--muted); text-decoration: none; }
  .links a:hover { color: var(--accent); }
</style>
</head>
<body
  data-next="${escapeHtml(safeNext)}"
  data-auto-provider="${escapeHtml(autoProvider || '')}"
  data-firebase-enabled="${cfg.enabled ? '1' : '0'}"
>
  <div class="wrap">
    <a class="brand" href="/">
      <span class="brand-dot"></span>
      <span>Cape May Dispatch</span>
    </a>
    <div class="card">
      <div id="auth-status" class="status-msg" role="status" aria-live="polite"></div>
      ${
        user
          ? `
        <h1>Signed In</h1>
        <p class="sub">Your Cape May Dispatch account is active across the 3D Map and Local Console.</p>
        <div class="profile-row">
          <div>
            <div style="font-weight:700">${escapeHtml(user.displayName || user.username)} <span class="badge">${escapeHtml(user.role)}</span></div>
            <div style="color:var(--muted);font-size:0.86rem">${escapeHtml(user.email || user.username)}</div>
          </div>
        </div>
        <a class="btn btn-primary" href="${escapeHtml(safeNext)}">Open Live 3D Map</a>
        ${user.isAdmin ? '<a class="btn" href="/manager">Open Manager Console</a>' : ''}
        <button type="button" id="btn-logout" class="btn">Sign Out</button>
        <button type="button" id="btn-delete-account" class="btn btn-danger">Delete My Account Permanently</button>
      `
          : `
        <h1>Sign In</h1>
        <p class="sub">Sign in with your Google or Apple account (Firebase project <code>cape-dispatch</code>). Existing Cape May Dispatch accounts keep the same profile and permissions.</p>
        <button type="button" id="btn-google" class="btn btn-google">
          <span>Continue with Google</span>
        </button>
        <button type="button" id="btn-apple" class="btn btn-apple">
          <span>Continue with Apple</span>
        </button>
        <a class="btn" href="/">Continue to Live Map without Signing In</a>
      `
      }
      <div class="links">
        <a href="/privacy">Privacy Policy</a>
        <a href="/support">Support</a>
        <a href="/terms">Terms of Use</a>
      </div>
    </div>
  </div>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
  <script type="module" src="/cape-auth.js"></script>
</body>
</html>`;
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function createAuthHandler({
  env = process.env,
  fetchImpl = fetch,
  certProvider = null,
  now = Date.now,
} = {}) {
  const allowAuthPost = makeRateLimiter({ windowMs: 60_000, max: 30, globalMax: 300 });

  return async function handleAuthRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    const json = (status, body, extraHeaders = {}) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders,
      });
      res.end(JSON.stringify(body));
      return true;
    };

    if (pathname === '/api/auth/firebase-config' && req.method === 'GET') {
      return json(200, firebaseClientConfig(env));
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const user = getSessionUser(req, { env, now });
      return json(200, { authenticated: Boolean(user), user });
    }

    if (pathname === '/api/auth/firebase' && req.method === 'POST') {
      if (!allowAuthPost(clientKey(req))) {
        return json(429, { error: 'Too many sign-in attempts. Please wait a minute.' }, { 'Retry-After': '60' });
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return json(400, { error: err.message });
      }
      const idToken = String(body?.id_token || body?.idToken || '').trim();
      if (!idToken) {
        return json(400, { error: 'Missing id_token' });
      }
      try {
        const verified = await verifyFirebaseIdToken(idToken, {
          env,
          fetchImpl,
          certProvider,
          now,
        });
        const user = upsertFirebaseAccount(verified, env);
        const sessionToken = createSessionToken(user, { env, now });
        return json(
          200,
          { ok: true, user },
          { 'Set-Cookie': buildSessionCookie(sessionToken, { env }) },
        );
      } catch (err) {
        return json(401, { error: err.message || 'Firebase authentication failed' });
      }
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      return json(
        200,
        { ok: true },
        { 'Set-Cookie': buildSessionCookie('', { env, clear: true }) },
      );
    }

    if (pathname === '/api/auth/delete-account' && req.method === 'POST') {
      const user = getSessionUser(req, { env, now });
      if (!user) {
        return json(401, { error: 'Sign in required to delete account' });
      }
      deleteAccountForUser(user, env);
      return json(
        200,
        { ok: true, deleted: true },
        { 'Set-Cookie': buildSessionCookie('', { env, clear: true }) },
      );
    }

    if (pathname === '/logout' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(302, {
        ...BROWSER_HEADERS,
        Location: '/login',
        'Set-Cookie': buildSessionCookie('', { env, clear: true }),
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }

    if (
      pathname === '/login' ||
      pathname === '/account' ||
      pathname === '/auth/google' ||
      pathname === '/auth/google/callback' ||
      pathname === '/auth/apple' ||
      pathname === '/auth/apple/callback'
    ) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...BROWSER_HEADERS, Allow: 'GET, HEAD' });
        res.end('Method Not Allowed');
        return true;
      }
      const user = getSessionUser(req, { env, now });
      const nextUrl = url.searchParams.get('next') || '/';
      const autoProvider = pathname.startsWith('/auth/google')
        ? 'google'
        : pathname.startsWith('/auth/apple')
          ? 'apple'
          : null;
      const html = renderAuthPageHtml({ user, nextUrl, autoProvider, env });
      res.writeHead(200, {
        ...BROWSER_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return true;
    }

    return false;
  };
}

export function installAuthRoutes(server, options = {}) {
  const handle = createAuthHandler(options);
  server.middlewares.use((req, res, next) => {
    Promise.resolve(handle(req, res))
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Authentication service error' }));
        }
      });
  });
}
