import { fetchSocial } from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, fmtWhen, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'social' });

const statusEl = document.querySelector('#status');
const feedEl = document.querySelector('#feed');
const refreshBtn = document.querySelector('#refresh');

function renderItem(item) {
  const meta = [item.platform, item.source, item.town, fmtWhen(item.at)]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const title = item.url
    ? `<a href="${esc(item.url)}" target="_blank" rel="noopener"><b>${esc(item.title)}</b></a>`
    : `<b>${esc(item.title)}</b>`;
  const body = item.body
    ? `<div class="ops-feed-body">${esc(item.body)}</div>`
    : '';
  return `<article class="ops-feed-item"><div class="ops-feed-meta">${meta || 'post'}</div>${title}${body}</article>`;
}

async function load() {
  setStatus(statusEl, 'Loading social feed…');
  refreshBtn.disabled = true;
  try {
    const data = await fetchSocial();
    const items = data.items || [];
    feedEl.innerHTML = items.length
      ? items.map(renderItem).join('')
      : note(
          data.sources?.firewire
            ? 'Feed quiet — no board wire / social / news posts yet.'
            : 'Fire Wire offline / unconfigured — set FIREWIRE_URL for the social wire.',
        );
    const src = Object.entries(data.sources || {})
      .filter(([, on]) => on)
      .map(([k]) => k)
      .join(', ');
    setStatus(
      statusEl,
      `${items.length} post(s)${src ? ` · ${src}` : ''}${data.stale ? ' (stale)' : ''}`,
      items.length ? 'ok' : '',
    );
  } catch (error) {
    feedEl.innerHTML = note(error.message || 'Social feed unavailable');
    setStatus(statusEl, error.message || 'Social feed unavailable', 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', () => void load());
void load();
setInterval(load, 60_000);
