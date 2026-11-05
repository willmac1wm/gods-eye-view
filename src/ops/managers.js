import {
  capeGet,
  fetchManagerPath,
  fetchManagerSession,
  getManagerToken,
  setManagerToken,
} from './api.js';
import { OPS_PAGES } from './catalog.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'managers' });

const tokenInput = document.querySelector('#token');
const signInBtn = document.querySelector('#sign-in');
const signOutBtn = document.querySelector('#sign-out');
const authStatus = document.querySelector('#auth-status');
const desk = document.querySelector('#desk');
const statusEl = document.querySelector('#status');
const outEl = document.querySelector('#out');
const appMapEl = document.querySelector('#app-map');
const healthEl = document.querySelector('#health');
const controlsEl = document.querySelector('#controls');
const upstreamPanel = document.querySelector('#upstream');

tokenInput.value = getManagerToken();

/** GEV-local Cape strip toggle the globe already honors. */
function capeStripEnabled() {
  try {
    return localStorage.getItem('gev.cape') !== 'off';
  } catch {
    return true;
  }
}

function setCapeStrip(on) {
  try {
    if (on) localStorage.removeItem('gev.cape');
    else localStorage.setItem('gev.cape', 'off');
  } catch {
    /* ignore */
  }
  renderControls();
}

function renderAppMap() {
  appMapEl.innerHTML = listHtml([
    '<a href="/"><b>Globe</b></a> — heads-up CAD, CCTV, RADIO, Cape layers',
    ...OPS_PAGES.filter((p) => p.id !== 'hub' && p.id !== 'managers').map(
      (p) =>
        `<a href="${p.href}"><b>${esc(p.title)}</b></a> — ${esc(p.blurb)}`,
    ),
  ]);
}

function renderControls() {
  const stripOn = capeStripEnabled();
  controlsEl.innerHTML = `
    <dl class="ops-kv ops-grid">
      <div><dt>Cape status strip</dt><dd>${stripOn ? 'ON' : 'OFF'}</dd></div>
      <div><dt>Effect</dt><dd>Applies on next globe load / refresh</dd></div>
    </dl>
    <div class="ops-row" style="margin-top:0.75rem">
      <button class="ops-btn" type="button" data-cape-strip="on">Enable strip</button>
      <button class="ops-btn" type="button" data-cape-strip="off">Disable strip</button>
      <a class="ops-btn" href="/" style="text-decoration:none;display:inline-flex;align-items:center">Open globe</a>
    </div>
    <p class="ops-note">Managers controls GEV-local prefs here. Fire Wire review/queue tools below need FIREWIRE_URL + matching manager APIs — they do not toggle globe layers directly.</p>
  `;
}

async function renderHealth() {
  healthEl.innerHTML = note('Probing Cape / Fire Wire health…');
  const health = await capeGet('health/sources');
  if (!health || typeof health !== 'object') {
    healthEl.innerHTML = note(
      'Cape health unavailable — set FIREWIRE_URL or use globe strip Native fallbacks.',
    );
    return;
  }
  const rows = Object.entries(health).map(([key, source]) => {
    const state = source?.state || source?.status || '?';
    const age =
      source?.age_s != null ? `${source.age_s}s` : source?.age || '—';
    return [key, `${state} · age ${age}`];
  });
  healthEl.innerHTML =
    kv(rows.slice(0, 24)) +
    '<p class="ops-note"><a href="/ops/board">Board</a> · <a href="/ops/incidents">Incidents</a> · <a href="/ops/scanners">Scanners</a></p>';
}

async function refreshSession() {
  try {
    const session = await fetchManagerSession();
    if (!session.configured) {
      setStatus(
        authStatus,
        'Host missing CAPE_MANAGER_TOKEN — upstream Fire Wire tools locked; GEV controls still work below',
        '',
      );
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    if (!session.authenticated) {
      setStatus(authStatus, 'Locked — enter manager token for Fire Wire tools', '');
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    setStatus(authStatus, 'Unlocked · Fire Wire manager proxy ready', 'ok');
    upstreamPanel.hidden = false;
    desk.hidden = false;
    return true;
  } catch (error) {
    if (error.status === 401) {
      setManagerToken('');
      tokenInput.value = '';
      setStatus(authStatus, 'Unauthorized — token rejected', 'error');
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    setStatus(authStatus, error.message || 'Session check failed', 'error');
    upstreamPanel.hidden = true;
    desk.hidden = false;
    return false;
  }
}

async function loadTool(path) {
  setStatus(statusEl, `Loading manager/${path}…`);
  outEl.textContent = '';
  try {
    const body = await fetchManagerPath(path);
    outEl.textContent =
      typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    setStatus(statusEl, `Ready · manager/${path}`, 'ok');
  } catch (error) {
    outEl.textContent = error.message || 'Request failed';
    setStatus(statusEl, error.message || 'Request failed', 'error');
    if (error.status === 401) {
      setManagerToken('');
      upstreamPanel.hidden = true;
      setStatus(authStatus, 'Session expired — unlock again', 'error');
    }
  }
}

signInBtn.addEventListener('click', async () => {
  setManagerToken(tokenInput.value.trim());
  const ok = await refreshSession();
  if (ok) void loadTool('status');
});

signOutBtn.addEventListener('click', () => {
  setManagerToken('');
  tokenInput.value = '';
  upstreamPanel.hidden = true;
  outEl.textContent = '';
  setStatus(authStatus, 'Locked — GEV controls remain available', '');
});

upstreamPanel.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('[data-mgr]');
  if (!btn) return;
  void loadTool(btn.getAttribute('data-mgr'));
});

controlsEl.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('[data-cape-strip]');
  if (!btn) return;
  setCapeStrip(btn.getAttribute('data-cape-strip') === 'on');
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInBtn.click();
});

renderAppMap();
renderControls();
void renderHealth();
void (async () => {
  const ok = await refreshSession();
  if (ok) void loadTool('status');
})();
