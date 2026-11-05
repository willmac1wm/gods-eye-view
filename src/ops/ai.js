import {
  applyDeskViewability,
  fetchOpsConfig,
  saveOpsConfig,
} from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import './ops.css';

mountOpsShell({ page: 'ai' });

const briefEl = document.querySelector('#brief');
const askEl = document.querySelector('#ask');
const notesEl = document.querySelector('#notes');
const statusEl = document.querySelector('#status');
const saveBtn = document.querySelector('#save');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'ai',
  pollMs: 300_000,
});

let config = null;

async function load() {
  await health.probe(async () => {
    config = await fetchOpsConfig({ force: true });
    if (!applyDeskViewability(config, 'ai', statusEl)) {
      briefEl.disabled = true;
      askEl.disabled = true;
      saveBtn.disabled = true;
      return { source: 'manager-config', gated: true };
    }
    briefEl.value = config.ai?.briefOverride || '';
    askEl.value = config.ai?.askOverride || '';
    notesEl.textContent = config.ai?.notes || '';
    if (config.permissions?.canEditAiPrompts === false) {
      briefEl.disabled = true;
      askEl.disabled = true;
      saveBtn.disabled = true;
      setStatus(statusEl, 'Editing disabled by Managers permissions', '');
    } else {
      setStatus(statusEl, config.updatedAt ? `Loaded · ${config.updatedAt}` : 'Loaded defaults', 'ok');
    }
    return { source: 'manager-config' };
  });
}

saveBtn.addEventListener('click', async () => {
  if (!config) return;
  if (
    config.approvals?.requireConfirmAiOverrides &&
    !window.confirm('Save AI prompt overrides?')
  ) {
    setStatus(statusEl, 'Cancelled', '');
    return;
  }
  setStatus(statusEl, 'Saving…');
  try {
    const next = {
      ...config,
      ai: {
        ...config.ai,
        briefOverride: briefEl.value,
        askOverride: askEl.value,
      },
    };
    config = await saveOpsConfig(next);
    setStatus(statusEl, `Saved · ${config.updatedAt || 'ok'}`, 'ok');
  } catch (error) {
    setStatus(statusEl, error.message || 'Save failed', 'error');
  }
});

void load();
