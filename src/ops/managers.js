import {
  fetchManagerPath,
  fetchManagerSession,
  getManagerToken,
  setManagerToken,
} from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'managers' });

const tokenInput = document.querySelector('#token');
const signInBtn = document.querySelector('#sign-in');
const signOutBtn = document.querySelector('#sign-out');
const authStatus = document.querySelector('#auth-status');
const desk = document.querySelector('#desk');
const statusEl = document.querySelector('#status');
const outEl = document.querySelector('#out');

tokenInput.value = getManagerToken();

async function refreshSession() {
  try {
    const session = await fetchManagerSession();
    if (!session.configured) {
      setStatus(
        authStatus,
        'Host missing CAPE_MANAGER_TOKEN / FIREWIRE_MANAGER_TOKEN',
        'error',
      );
      desk.hidden = true;
      return false;
    }
    if (!session.authenticated) {
      setStatus(authStatus, 'Locked — enter manager token', '');
      desk.hidden = true;
      return false;
    }
    setStatus(authStatus, 'Unlocked · session token accepted', 'ok');
    desk.hidden = false;
    return true;
  } catch (error) {
    if (error.status === 401) {
      setManagerToken('');
      tokenInput.value = '';
      setStatus(authStatus, 'Unauthorized — token rejected', 'error');
      desk.hidden = true;
      return false;
    }
    setStatus(authStatus, error.message || 'Session check failed', 'error');
    desk.hidden = true;
    return false;
  }
}

async function loadTool(path) {
  setStatus(statusEl, `Loading ${path}…`);
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
      desk.hidden = true;
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
  desk.hidden = true;
  outEl.textContent = '';
  setStatus(authStatus, 'Locked', '');
});

desk.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('[data-mgr]');
  if (!btn) return;
  void loadTool(btn.getAttribute('data-mgr'));
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInBtn.click();
});

void (async () => {
  const ok = await refreshSession();
  if (ok) void loadTool('status');
  else if (!getManagerToken()) {
    authStatus.insertAdjacentHTML(
      'afterend',
      note(
        'Managers is not public. Operators set CAPE_MANAGER_TOKEN on GEV; Fire Wire serves /api/manager/*.',
      ),
    );
  }
})();
