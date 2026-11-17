import { fetchSocial } from './api.js';
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, fmtWhen, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'social' });

const statusEl = document.querySelector('#status');
const feedEl = document.querySelector('#feed');
const refreshBtn = document.querySelector('#refresh');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'social',
  pollMs: 60_000,
});

let timer = null;
let config = null;

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

function filterBySources(items, sources) {
  if (!sources) return items;
  return items.filter((item) => {
    const src = String(item.source || '');
    if (src === 'board-wire' || src.startsWith('board')) {
      return sources.board !== false;
    }
    if (src === 'news') return sources.news !== false;
    if (src === 'social') return sources.social !== false;
    if (src === 'wire') return sources.wire !== false;
    return true;
  });
}

async function load() {
  setStatus(statusEl, 'Loading social feed…');
  refreshBtn.disabled = true;
  try {
    await health.probe(async () => {
      const data = await fetchSocial({ kind: 'social' });
      let items = filterBySources(data.items || [], config?.sources?.social);
      // Prefer platform/social items; keep board if social collector empty.
      const socialOnly = items.filter((i) => i.source === 'social');
      if (socialOnly.length) items = socialOnly;
      feedEl.innerHTML = items.length
        ? items.map(renderItem).join('')
        : note(
            data.sources?.firewire
              ? 'Feed quiet — no social posts yet. See News for board wire.'
              : 'Social wire quiet — in-app Fire Wire has no posts yet.',
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
      return { source: src || 'ops-social', stale: Boolean(data.stale) };
    });
  } catch (error) {
    feedEl.innerHTML = note(error.message || 'Social feed unavailable');
    setStatus(statusEl, error.message || 'Social feed unavailable', 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

function schedule(ms) {
  if (timer) clearInterval(timer);
  health.setPollMs(ms);
  timer = setInterval(() => void load(), ms);
}

refreshBtn.addEventListener('click', () => void load());

void (async () => {
  config = await fetchOpsConfig();
  if (!applyDeskViewability(config, 'social', statusEl)) return;
  schedule(intervalFor(config, 'social', 60_000));
  await load();
})();
