import { fetchNews } from './api.js';
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, fmtWhen, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'news' });

const statusEl = document.querySelector('#status');
const feedEl = document.querySelector('#feed');
const refreshBtn = document.querySelector('#refresh');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'news',
  pollMs: 90_000,
});

let timer = null;

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
  return `<article class="ops-feed-item"><div class="ops-feed-meta">${meta || 'news'}</div>${title}${body}</article>`;
}

function filterBySources(items, sources) {
  if (!sources) return items;
  return items.filter((item) => {
    const src = String(item.source || '');
    if (src === 'board-wire' || src.startsWith('board')) {
      return sources.board !== false;
    }
    if (src === 'news') return sources.news !== false;
    if (src === 'wire') return sources.wire !== false;
    if (src === 'social') return false;
    return true;
  });
}

async function load(config) {
  setStatus(statusEl, 'Loading news…');
  refreshBtn.disabled = true;
  try {
    await health.probe(async () => {
      const data = await fetchNews();
      const items = filterBySources(data.items || [], config?.sources?.social);
      feedEl.innerHTML = items.length
        ? items.map(renderItem).join('')
        : note(
            data.sources?.firewire
              ? 'News quiet — no board / news / wire posts yet.'
              : 'News wire quiet — in-app Fire Wire has no posts yet.',
          );
      const src = Object.entries(data.sources || {})
        .filter(([, on]) => on)
        .map(([k]) => k)
        .join(', ');
      setStatus(
        statusEl,
        `${items.length} item(s)${src ? ` · ${src}` : ''}${data.stale ? ' (stale)' : ''}`,
        items.length ? 'ok' : '',
      );
      return {
        source: src || 'ops-social?kind=news',
        stale: Boolean(data.stale),
      };
    });
  } catch (error) {
    feedEl.innerHTML = note(error.message || 'News unavailable');
    setStatus(statusEl, error.message || 'News unavailable', 'error');
  } finally {
    refreshBtn.disabled = false;
  }
}

function schedule(ms, config) {
  if (timer) clearInterval(timer);
  health.setPollMs(ms);
  timer = setInterval(() => void load(config), ms);
}

void (async () => {
  const config = await fetchOpsConfig();
  if (!applyDeskViewability(config, 'news', statusEl)) return;
  refreshBtn.addEventListener('click', () => void load(config));
  schedule(intervalFor(config, 'news', 90_000), config);
  await load(config);
})();
