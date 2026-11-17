import { fetchMessages, postMessage } from './api.js';
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, fmtWhen, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'messages' });

const fromInput = document.querySelector('#from');
const textInput = document.querySelector('#text');
const sendBtn = document.querySelector('#send');
const refreshBtn = document.querySelector('#refresh');
const statusEl = document.querySelector('#status');
const threadEl = document.querySelector('#thread');

try {
  fromInput.value = localStorage.getItem('gev.cape.msgFrom') || '';
} catch {
  /* ignore */
}

const health = createPageHealth(ensureHealthHost(), {
  desk: 'messages',
  pollMs: 15_000,
});

let timer = null;

function renderMessages(list) {
  if (!list?.length) {
    threadEl.innerHTML = note('No messages yet.');
    return;
  }
  threadEl.innerHTML = list
    .slice()
    .reverse()
    .map(
      (m) => `
      <article class="ops-msg">
        <div class="ops-msg-meta">${esc(m.from)} · ${esc(fmtWhen(m.at) || m.at || '')}</div>
        <div>${esc(m.text)}</div>
      </article>`,
    )
    .join('');
}

async function load() {
  setStatus(statusEl, 'Loading…');
  try {
    await health.probe(async () => {
      const data = await fetchMessages();
      renderMessages(data.messages || []);
      setStatus(
        statusEl,
        `${data.count ?? data.messages?.length ?? 0} message(s)`,
        'ok',
      );
      return { source: 'ops-messages' };
    });
  } catch (error) {
    threadEl.innerHTML = note(error.message || 'Messages unavailable');
    setStatus(statusEl, error.message || 'Messages unavailable', 'error');
  }
}

async function send() {
  const from = fromInput.value.trim() || 'operator';
  const text = textInput.value.trim();
  if (!text) {
    setStatus(statusEl, 'Enter a message', 'error');
    return;
  }
  sendBtn.disabled = true;
  try {
    try {
      localStorage.setItem('gev.cape.msgFrom', from);
    } catch {
      /* ignore */
    }
    await postMessage({ from, text });
    textInput.value = '';
    setStatus(statusEl, 'Sent', 'ok');
    await load();
  } catch (error) {
    setStatus(statusEl, error.message || 'Send failed', 'error');
  } finally {
    sendBtn.disabled = false;
  }
}

function schedule(ms) {
  if (timer) clearInterval(timer);
  health.setPollMs(ms);
  timer = setInterval(() => void load(), ms);
}

sendBtn.addEventListener('click', () => void send());
refreshBtn.addEventListener('click', () => void load());
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
});

void (async () => {
  const cfg = await fetchOpsConfig();
  if (!applyDeskViewability(cfg, 'messages', statusEl)) return;
  if (cfg.permissions?.canPostMessages === false) {
    sendBtn.disabled = true;
    setStatus(statusEl, 'Posting disabled by Managers permissions', '');
  }
  schedule(intervalFor(cfg, 'messages', 15_000));
  await load();
})();
