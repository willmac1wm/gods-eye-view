/**
 * Cape May Dispatch Managers Page (`/manager` and `/api/manager/*`) +
 * Public Runtime App Configuration (`GET /api/local/app-config`).
 *
 * Controls this app directly:
 *   1. Settings (announcement banner, default town, community reports open/closed,
 *      daily AI request & USD caps).
 *   2. Layers (default enabled/disabled & hidden state for Local and 3D Globe layers).
 *   3. Approving Community Reports (inspect pending reports + photos, Approve as
 *      Public, Approve & Verify, Reject/Hide, or Delete).
 *   4. AI Chat & Voice On/Off Switch (persisted in `.gev-data/manager-config.json`
 *      and enforced immediately in `admitLlmRequest` and the browser UI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_HEADERS } from '../../../build/vite.js';
import {
  envFlag,
  getLlmBudgetSnapshot,
  presentedAdminToken,
  sanitizeReportText,
  setRuntimeLlmOverrides,
  tokensEqual,
} from '../../../src/publicExposure.mjs';
import { getSessionUser } from './auth.js';

export const MANAGED_LAYERS = [
  { id: 'nws-alerts', name: 'NWS Alerts', group: 'Local Awareness', defaultOn: true },
  { id: 'tide-gauges', name: 'Tide & Flood Gauges', group: 'Local Awareness', defaultOn: true },
  { id: 'power-outages', name: 'Power Outages (ACE)', group: 'Local Awareness', defaultOn: true },
  { id: 'traffic-incidents', name: 'Traffic Incidents (TomTom)', group: 'Local Awareness', defaultOn: true },
  { id: 'emergency-facilities', name: 'Emergency Facilities (OSM)', group: 'Local Awareness', defaultOn: false },
  { id: 'marine-buoys', name: 'Marine Buoys (NOAA)', group: 'Local Awareness', defaultOn: true },
  { id: 'airport-weather', name: 'Airport Weather (METAR)', group: 'Local Awareness', defaultOn: false },
  { id: 'whale-zones', name: 'Right Whale Speed Zones', group: 'Local Awareness', defaultOn: false },
  { id: 'military-areas', name: 'Military / USCG Areas', group: 'Local Awareness', defaultOn: false },
  { id: 'airport-radio', name: 'Airport Radio (KACY ATC)', group: 'Local Awareness', defaultOn: false },
  { id: 'scanner-calls', name: 'Police, Fire & EMS Calls', group: 'Local Awareness', defaultOn: true },
  { id: 'predicted-flooding', name: 'Predicted Flooding (Estimate)', group: 'Local Awareness', defaultOn: false },
  { id: 'community-reports', name: 'Community Reports', group: 'Local Awareness', defaultOn: true },
  { id: 'flights', name: 'Live Aircraft (ADS-B)', group: '3D Globe', defaultOn: true },
  { id: 'ships', name: 'Marine Vessels (AIS)', group: '3D Globe', defaultOn: true },
  { id: 'weatherRadar', name: 'Weather Radar (MRMS)', group: '3D Globe', defaultOn: false },
  { id: 'traffic', name: 'Street Traffic Flow', group: '3D Globe', defaultOn: false },
  { id: 'cctv', name: 'Traffic & Ferry Cameras', group: '3D Globe', defaultOn: false },
  { id: 'satellites', name: 'Satellites', group: '3D Globe', defaultOn: false },
  { id: 'fires', name: 'Wildfires / Thermal Hotspots', group: '3D Globe', defaultOn: false },
  { id: 'earthquakes', name: 'Earthquakes', group: '3D Globe', defaultOn: false },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultDataDir(env = process.env) {
  return env.GEV_DATA_DIR
    ? path.resolve(env.GEV_DATA_DIR)
    : path.join(process.cwd(), '.gev-data');
}

function defaultReportDir(env = process.env) {
  return env.GEV_REPORT_DIR
    ? path.resolve(env.GEV_REPORT_DIR)
    : path.join(defaultDataDir(env), 'community-reports');
}

function defaultManagerConfig(env = process.env) {
  const layers = {};
  for (const l of MANAGED_LAYERS) {
    layers[l.id] = { enabledByDefault: l.defaultOn, hidden: false };
  }
  return {
    aiChatEnabled: !envFlag(env?.GEV_LLM_DISABLED),
    dailyRequestCap: Number(env?.GEV_LLM_DAILY_REQUEST_CAP) || 800,
    dailyUsdCap: Number(env?.GEV_LLM_DAILY_USD_CAP) || 5,
    settings: {
      bannerText: '',
      bannerSeverity: 'info',
      defaultTown: '',
      reportsOpen: true,
    },
    layers,
    updatedAt: null,
    updatedBy: null,
  };
}

export function loadManagerConfig(env = process.env) {
  const base = defaultManagerConfig(env);
  const file = path.join(defaultDataDir(env), 'manager-config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw.aiChatEnabled === 'boolean') {
      base.aiChatEnabled = raw.aiChatEnabled;
    }
    if (Number.isFinite(Number(raw.dailyRequestCap)) && Number(raw.dailyRequestCap) >= 0) {
      base.dailyRequestCap = Number(raw.dailyRequestCap);
    }
    if (Number.isFinite(Number(raw.dailyUsdCap)) && Number(raw.dailyUsdCap) >= 0) {
      base.dailyUsdCap = Number(raw.dailyUsdCap);
    }
    if (raw.settings && typeof raw.settings === 'object') {
      base.settings = {
        bannerText: sanitizeReportText(raw.settings.bannerText || '').slice(0, 280),
        bannerSeverity: ['info', 'warn', 'danger'].includes(raw.settings.bannerSeverity)
          ? raw.settings.bannerSeverity
          : 'info',
        defaultTown: sanitizeReportText(raw.settings.defaultTown || '').slice(0, 60),
        reportsOpen: raw.settings.reportsOpen !== false,
      };
    }
    if (raw.layers && typeof raw.layers === 'object') {
      for (const l of MANAGED_LAYERS) {
        const over = raw.layers[l.id];
        if (over && typeof over === 'object') {
          base.layers[l.id] = {
            enabledByDefault:
              typeof over.enabledByDefault === 'boolean' ? over.enabledByDefault : l.defaultOn,
            hidden: Boolean(over.hidden),
          };
        }
      }
    }
    base.updatedAt = raw.updatedAt || null;
    base.updatedBy = raw.updatedBy || null;
  } catch {
    /* use defaults */
  }
  return base;
}

export function syncRuntimeFromManagerConfig(config) {
  setRuntimeLlmOverrides({
    aiChatEnabled: Boolean(config.aiChatEnabled),
    dailyRequestCap: Number(config.dailyRequestCap),
    dailyUsdCap: Number(config.dailyUsdCap),
  });
}

export function saveManagerConfig(partial, { env = process.env, actor = 'manager' } = {}) {
  const current = loadManagerConfig(env);
  if (typeof partial.aiChatEnabled === 'boolean') {
    current.aiChatEnabled = partial.aiChatEnabled;
  }
  if (partial.dailyRequestCap !== undefined && Number.isFinite(Number(partial.dailyRequestCap))) {
    current.dailyRequestCap = Math.max(0, Math.round(Number(partial.dailyRequestCap)));
  }
  if (partial.dailyUsdCap !== undefined && Number.isFinite(Number(partial.dailyUsdCap))) {
    current.dailyUsdCap = Math.max(0, Number(partial.dailyUsdCap));
  }
  if (partial.settings && typeof partial.settings === 'object') {
    if (partial.settings.bannerText !== undefined) {
      current.settings.bannerText = sanitizeReportText(partial.settings.bannerText).slice(0, 280);
    }
    if (['info', 'warn', 'danger'].includes(partial.settings.bannerSeverity)) {
      current.settings.bannerSeverity = partial.settings.bannerSeverity;
    }
    if (partial.settings.defaultTown !== undefined) {
      current.settings.defaultTown = sanitizeReportText(partial.settings.defaultTown).slice(0, 60);
    }
    if (typeof partial.settings.reportsOpen === 'boolean') {
      current.settings.reportsOpen = partial.settings.reportsOpen;
    }
  }
  if (partial.layers && typeof partial.layers === 'object') {
    for (const [id, val] of Object.entries(partial.layers)) {
      if (!current.layers[id] || !val || typeof val !== 'object') continue;
      if (typeof val.enabledByDefault === 'boolean') {
        current.layers[id].enabledByDefault = val.enabledByDefault;
      }
      if (typeof val.hidden === 'boolean') {
        current.layers[id].hidden = val.hidden;
      }
    }
  }
  current.updatedAt = new Date().toISOString();
  current.updatedBy = actor;

  const dir = defaultDataDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manager-config.json'), JSON.stringify(current, null, 2));
  syncRuntimeFromManagerConfig(current);
  return current;
}

export function isManagerAuthorized(req, { env = process.env, now = Date.now } = {}) {
  const user = getSessionUser(req, { env, now });
  if (user?.isAdmin) {
    return { ok: true, user, via: 'session' };
  }
  const adminToken = String(env?.GEV_ADMIN_TOKEN || '').trim();
  const presented = presentedAdminToken(req);
  if (adminToken.length >= 24 && tokensEqual(presented, adminToken)) {
    return {
      ok: true,
      user: { username: 'token-admin', displayName: 'Token Admin', role: 'admin', isAdmin: true },
      via: 'token',
    };
  }
  return { ok: false, user };
}

export function listAllCommunityReports(env = process.env) {
  const dir = defaultReportDir(env);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const reports = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      reports.push({
        id: String(r.id),
        createdAt: r.createdAt || null,
        category: r.category || 'other',
        text: sanitizeReportText(r.text || ''),
        town: r.town || null,
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        photo: r.photo ? `/api/manager/reports/${encodeURIComponent(r.id)}/photo` : null,
        status: r.status || 'pending-review',
        visibility: r.visibility || 'private',
        verified: Boolean(r.verified),
        reviewedAt: r.reviewedAt || null,
        reviewedBy: r.reviewedBy || null,
      });
    } catch {
      /* skip malformed */
    }
  }
  return reports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function moderateCommunityReport(
  reportId,
  action,
  { env = process.env, actor = 'manager' } = {},
) {
  const cleanId = String(reportId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanId) return { ok: false, status: 400, error: 'Invalid report ID' };
  const dir = defaultReportDir(env);
  const jsonPath = path.join(dir, `${cleanId}.json`);
  if (!fs.existsSync(jsonPath)) {
    return { ok: false, status: 404, error: 'Report not found' };
  }
  if (action === 'delete') {
    try {
      const r = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (r.photo) {
        const photoPath = path.join(dir, path.basename(String(r.photo)));
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
      }
    } catch {
      /* ignore */
    }
    fs.unlinkSync(jsonPath);
    return { ok: true, deleted: true, id: cleanId };
  }

  const record = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (action === 'approve') {
    record.status = 'approved';
    record.visibility = 'public';
    record.verified = false;
  } else if (action === 'verify') {
    record.status = 'approved';
    record.visibility = 'public';
    record.verified = true;
  } else if (action === 'reject') {
    record.status = 'rejected';
    record.visibility = 'private';
    record.verified = false;
  } else {
    return { ok: false, status: 400, error: 'Unknown moderation action' };
  }
  record.reviewedAt = new Date().toISOString();
  record.reviewedBy = actor;
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  return { ok: true, report: record };
}

export function publicAppConfig(req, { env = process.env, now = Date.now } = {}) {
  const cfg = loadManagerConfig(env);
  const user = getSessionUser(req, { env, now });
  return {
    aiChatEnabled: Boolean(cfg.aiChatEnabled) && !envFlag(env?.GEV_LLM_DISABLED),
    settings: cfg.settings,
    layers: cfg.layers,
    auth: {
      authenticated: Boolean(user),
      user: user
        ? {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            isAdmin: user.isAdmin,
          }
        : null,
    },
  };
}

export function renderManagerPageHtml({ user }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0e17">
<title>Manager Console — Cape May Dispatch</title>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<style>
  :root {
    --bg: #070b12;
    --panel: #111827;
    --panel-alt: #1a2333;
    --border: #1f2937;
    --text: #e5e7eb;
    --muted: #9ca3af;
    --accent: #38bdf8;
    --ok: #34d399;
    --warn: #fbbf24;
    --danger: #f87171;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.5;
  }
  .wrap {
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px 20px 64px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 18px;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 700;
    font-size: 1.15rem;
    color: var(--text);
    text-decoration: none;
  }
  .brand-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .nav-links {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 0.9rem;
  }
  .nav-links a {
    color: var(--accent);
    text-decoration: none;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 20px;
    margin-bottom: 22px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 22px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1.15rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sub {
    color: var(--muted);
    font-size: 0.86rem;
    margin: 0 0 16px;
  }
  .ai-toggle-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--panel-alt);
    border: 1px solid var(--border);
    margin-bottom: 14px;
  }
  .status-pill {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  .status-pill.on { background: rgba(52, 211, 153, 0.16); color: var(--ok); }
  .status-pill.off { background: rgba(248, 113, 113, 0.16); color: var(--danger); }
  .status-pill.pending { background: rgba(251, 191, 36, 0.16); color: var(--warn); }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #1f2937;
    color: var(--text);
    font-weight: 600;
    font-size: 0.86rem;
    cursor: pointer;
    text-decoration: none;
  }
  .btn:hover { border-color: var(--accent); }
  .btn-primary { background: #0284c7; border-color: #38bdf8; color: #fff; }
  .btn-ok { background: rgba(52, 211, 153, 0.16); border-color: rgba(52, 211, 153, 0.4); color: var(--ok); }
  .btn-warn { background: rgba(251, 191, 36, 0.16); border-color: rgba(251, 191, 36, 0.4); color: var(--warn); }
  .btn-danger { background: rgba(248, 113, 113, 0.16); border-color: rgba(248, 113, 113, 0.4); color: var(--danger); }
  label {
    display: block;
    font-size: 0.86rem;
    margin-bottom: 10px;
    color: #d1d5db;
  }
  input[type="text"], input[type="number"], select {
    width: 100%;
    margin-top: 4px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #0b111e;
    color: var(--text);
    font-size: 0.9rem;
  }
  .layer-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .layer-table th, .layer-table td {
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .layer-table th { color: var(--muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; }
  .report-list {
    display: grid;
    gap: 12px;
  }
  .report-item {
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px 16px;
  }
  .report-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 10px 16px;
    border-radius: 10px;
    background: #0284c7;
    color: #fff;
    font-weight: 600;
    font-size: 0.88rem;
    display: none;
    z-index: 999;
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">
        <span class="brand-dot"></span>
        <span>Cape May Dispatch · Manager Console</span>
      </a>
      <div class="nav-links">
        <span style="color:var(--muted)">Signed in as <strong>${escapeHtml(user?.displayName || user?.username || 'Admin')}</strong></span>
        <a href="/">Open Live 3D Map &rarr;</a>
        <a href="/account">Account</a>
      </div>
    </header>

    <div class="grid-2">
      <!-- 1. AI Chat & Voice Kill Switch & Daily Spend Caps -->
      <section class="card" aria-labelledby="h-ai">
        <h2 id="h-ai">
          <span>AI Chat &amp; Voice Control</span>
          <span id="ai-status-pill" class="status-pill on">Loading…</span>
        </h2>
        <p class="sub">Immediately enable or disable Gemini / OpenAI local chat and voice across the entire site without restarting the server.</p>
        <div class="ai-toggle-box">
          <div>
            <strong id="ai-toggle-label">AI Local Chat &amp; Voice</strong>
            <div id="ai-usage-line" style="font-size:0.8rem;color:var(--muted)">Today: 0 requests · $0.00</div>
          </div>
          <button type="button" id="btn-toggle-ai" class="btn btn-primary">Toggle AI Chat</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Daily Request Cap
            <input type="number" id="inp-req-cap" min="0" step="10" value="800">
          </label>
          <label>Daily USD Cap ($)
            <input type="number" id="inp-usd-cap" min="0" step="0.5" value="5">
          </label>
        </div>
        <button type="button" id="btn-save-ai-caps" class="btn" style="margin-top:6px">Save AI Budget Caps</button>
      </section>

      <!-- 2. App Settings -->
      <section class="card" aria-labelledby="h-settings">
        <h2 id="h-settings">App Settings &amp; Alert Banner</h2>
        <p class="sub">Configure the county-wide top announcement banner, default town focus, and community report intake.</p>
        <label>Top Announcement Banner Text (leave blank to hide)
          <input type="text" id="inp-banner-text" maxlength="280" placeholder="e.g. Coastal Flood Warning in effect until 8 PM — use elevated routes">
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Banner Severity
            <select id="sel-banner-severity">
              <option value="info">Info (Blue)</option>
              <option value="warn">Warning (Amber)</option>
              <option value="danger">Emergency (Red)</option>
            </select>
          </label>
          <label>Default Municipality Focus
            <input type="text" id="inp-default-town" maxlength="60" placeholder="e.g. Wildwood or Cape May">
          </label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <input type="checkbox" id="chk-reports-open" checked>
          <span>Allow residents to submit new Community Reports</span>
        </label>
        <button type="button" id="btn-save-settings" class="btn btn-primary" style="margin-top:8px">Save App Settings</button>
      </section>
    </div>

    <!-- 3. Community Reports Review Queue -->
    <section class="card" aria-labelledby="h-reports">
      <h2 id="h-reports">
        <span>Community Reports Moderation Queue</span>
        <button type="button" id="btn-refresh-reports" class="btn">Refresh Queue</button>
      </h2>
      <p class="sub">Resident reports start as private (<code>pending-review</code>). Approving a report publishes it to the live map’s Community Reports layer and creates a shareable <code>/incidents/report:{id}</code> page.</p>
      <div id="reports-container" class="report-list">
        <div style="color:var(--muted)">Loading community reports…</div>
      </div>
    </section>

    <!-- 4. Map & 3D Layers Control -->
    <section class="card" aria-labelledby="h-layers">
      <h2 id="h-layers">
        <span>Map &amp; 3D Layers Control</span>
        <button type="button" id="btn-save-layers" class="btn btn-primary">Save Layer Defaults</button>
      </h2>
      <p class="sub">Control which Local Awareness and 3D Globe layers are enabled by default when visitors open Cape May Dispatch, or hide specific layers from the public UI.</p>
      <div style="overflow-x:auto">
        <table class="layer-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Category</th>
              <th>Enabled by Default</th>
              <th>Hidden from Public</th>
            </tr>
          </thead>
          <tbody id="layers-tbody"></tbody>
        </table>
      </div>
    </section>
  </div>
  <div id="mgr-toast" class="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/cape-manager.js"></script>
</body>
</html>`;
}

function renderForbiddenHtml(user) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manager Access Required — Cape May Dispatch</title>
<style>
  body { background:#0a0e17; color:#e5e7eb; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; margin:0; padding:48px 20px; text-align:center; }
  .card { max-width:480px; margin:0 auto; background:#111827; border:1px solid #1f2937; border-radius:14px; padding:28px; }
  a { color:#38bdf8; }
</style>
</head>
<body>
  <div class="card">
    <h1 style="margin-top:0;font-size:1.35rem">Manager Access Required</h1>
    <p style="color:#9ca3af;font-size:0.94rem">Signed in as <strong>${escapeHtml(user?.email || user?.username)}</strong>, which does not have manager permissions (<code>DISPATCH_ADMINS</code>).</p>
    <p><a href="/logout">Sign in with a Manager Account</a> &middot; <a href="/">Return to Map</a></p>
  </div>
</body>
</html>`;
}

function readJsonBody(req, limit = 256 * 1024) {
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

export function createManagerHandler({ env = process.env, now = Date.now } = {}) {
  // Sync runtime LLM overrides on startup from disk
  try {
    syncRuntimeFromManagerConfig(loadManagerConfig(env));
  } catch {
    /* ignore */
  }

  return async function handleManagerRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return false;
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
      return true;
    };

    // Public app-config endpoint used by the map client on boot
    if (pathname === '/api/local/app-config' && req.method === 'GET') {
      return json(200, publicAppConfig(req, { env, now }));
    }

    // HTML Manager Page at /manager
    if (pathname === '/manager') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...BROWSER_HEADERS, Allow: 'GET, HEAD' });
        res.end('Method Not Allowed');
        return true;
      }
      const auth = isManagerAuthorized(req, { env, now });
      if (!auth.ok) {
        if (!auth.user) {
          res.writeHead(302, {
            ...BROWSER_HEADERS,
            Location: '/login?next=%2Fmanager',
            'Cache-Control': 'no-store',
          });
          res.end();
          return true;
        }
        const forbidden = renderForbiddenHtml(auth.user);
        res.writeHead(403, {
          ...BROWSER_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : forbidden);
        return true;
      }
      const html = renderManagerPageHtml({ user: auth.user });
      res.writeHead(200, {
        ...BROWSER_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return true;
    }

    if (!pathname.startsWith('/api/manager')) {
      return false;
    }

    const auth = isManagerAuthorized(req, { env, now });
    if (!auth.ok) {
      return json(403, { error: 'Manager authorization required' });
    }

    if (pathname === '/api/manager/state' && req.method === 'GET') {
      const config = loadManagerConfig(env);
      const reports = listAllCommunityReports(env);
      const llmBudget = getLlmBudgetSnapshot(now());
      return json(200, {
        config,
        layerCatalog: MANAGED_LAYERS,
        reports,
        llmBudget,
        user: auth.user,
      });
    }

    if (pathname === '/api/manager/config' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return json(400, { error: err.message });
      }
      const updated = saveManagerConfig(body, {
        env,
        actor: auth.user?.username || 'manager',
      });
      return json(200, {
        ok: true,
        config: updated,
        llmBudget: getLlmBudgetSnapshot(now()),
      });
    }

    const photoMatch = /^\/api\/manager\/reports\/([^/]+)\/photo$/.exec(pathname);
    if (photoMatch && req.method === 'GET') {
      const cleanId = photoMatch[1].replace(/[^a-zA-Z0-9_-]/g, '');
      const jpgPath = path.join(defaultReportDir(env), `${cleanId}.jpg`);
      if (!fs.existsSync(jpgPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Photo not found');
        return true;
      }
      const buf = fs.readFileSync(jpgPath);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
      return true;
    }

    const modMatch = /^\/api\/manager\/reports\/([^/]+)$/.exec(pathname);
    if (modMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      let action = req.method === 'DELETE' ? 'delete' : '';
      if (req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          action = String(body?.action || '').trim();
        } catch (err) {
          return json(400, { error: err.message });
        }
      }
      const result = moderateCommunityReport(modMatch[1], action, {
        env,
        actor: auth.user?.username || 'manager',
      });
      if (!result.ok) {
        return json(result.status || 400, { error: result.error });
      }
      return json(200, {
        ...result,
        reports: listAllCommunityReports(env),
      });
    }

    return json(404, { error: 'Unknown manager endpoint' });
  };
}

export function installManagerRoutes(server, options = {}) {
  const handle = createManagerHandler(options);
  server.middlewares.use((req, res, next) => {
    Promise.resolve(handle(req, res))
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Manager service error' }));
        }
      });
  });
}
