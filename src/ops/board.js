import { capeGet } from './api.js';
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'board' });

const statusEl = document.querySelector('#status');
const officialEl = document.querySelector('#official');
const newsEl = document.querySelector('#news');
const countyEl = document.querySelector('#county');
const outagesEl = document.querySelector('#outages');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'board',
  pollMs: 60_000,
});

let timer = null;
let config = null;

async function fetchNative(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function load() {
  setStatus(statusEl, 'Loading board…');
  try {
    await health.probe(async () => {
      const [nativeBoard, nativeOutages, boardFw, county, outagesFw] =
        await Promise.all([
          fetchNative('/api/ops/board'),
          fetchNative('/api/ops/outages'),
          capeGet('board'),
          capeGet('county-status'),
          capeGet('power_outages'),
        ]);
      const board = nativeBoard?.official?.length
        ? nativeBoard
        : boardFw || nativeBoard;
      const outages = nativeOutages || outagesFw || board?.outages;
      const srcOn = config?.sources?.board || {};
      const sourceLabel = nativeBoard?.official?.length
        ? 'native'
        : boardFw
          ? 'firewire'
          : nativeBoard
            ? 'native'
            : 'none';
      if (!board && !county && !outages) {
        setStatus(
          statusEl,
          'Board quiet — native /api/ops/board and in-app Fire Wire both empty',
          'error',
        );
      } else {
        setStatus(statusEl, `Board ready (${sourceLabel})`, 'ok');
      }

      if (srcOn.official !== false) {
        const chips = board?.official || [];
        officialEl.innerHTML = chips.length
          ? `<div>${chips
              .map((c) => {
                const label = c.label || c.id || 'chip';
                const value = c.value != null ? c.value : c.tone || '';
                return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 6px;border:1px solid #2a6;border-radius:3px"><b>${esc(label)}</b> ${esc(value)}</span>`;
              })
              .join('')}</div>`
          : '<p class="ops-note">No official chips</p>';
        officialEl.closest('.ops-panel')?.classList.remove('ops-hidden');
      } else {
        officialEl.closest('.ops-panel')?.classList.add('ops-hidden');
      }

      if (srcOn.newsWire !== false) {
        const rumors = board?.flash_rumors || board?.news || [];
        newsEl.innerHTML =
          listHtml(
            rumors.slice(0, 12).map((item) => {
              const title = esc(
                item.title || item.keyword || item.text || 'Update',
              );
              const meta = [item.town, item.keyword, item.source]
                .filter(Boolean)
                .map(esc)
                .join(' · ');
              if (item.url && /^https?:\/\//i.test(item.url)) {
                return `<a href="${esc(item.url)}" target="_blank" rel="noopener">${title}</a>${meta ? `<div style="opacity:.75">${meta}</div>` : ''}`;
              }
              return `${title}${meta ? `<div style="opacity:.75">${meta}</div>` : ''}`;
            }),
          ) +
          '<p class="ops-note"><a href="/ops/news">Open News desk</a> · <a href="/ops/social">Social</a></p>';
        newsEl.closest('.ops-panel')?.classList.remove('ops-hidden');
      } else {
        newsEl.closest('.ops-panel')?.classList.add('ops-hidden');
      }

      if (srcOn.county !== false) {
        countyEl.innerHTML = county
          ? kv([
              ['Calls / 1h', county.calls_1h],
              ['Calls / 24h', county.calls_24h],
              ['Tide ft', county.tide?.level_ft],
              ['Power out', county.power?.county?.out],
              ['Power served', county.power?.county?.served],
              [
                'Rip current',
                county.rip_current?.risk || county.rip_current?.error,
              ],
            ])
          : '<p class="ops-note">County status unavailable (Fire Wire optional)</p>';
        countyEl.closest('.ops-panel')?.classList.remove('ops-hidden');
      } else {
        countyEl.closest('.ops-panel')?.classList.add('ops-hidden');
      }

      if (srcOn.outages !== false) {
        const counties = outages?.counties || {};
        outagesEl.innerHTML = listHtml(
          Object.entries(counties).map(([name, stats]) => {
            if (stats && typeof stats === 'object') {
              return `${esc(name)} — out ${esc(stats.out ?? 0)} / served ${esc(stats.served ?? '—')}`;
            }
            return `${esc(name)} — out ${esc(stats)}`;
          }),
        );
        outagesEl.closest('.ops-panel')?.classList.remove('ops-hidden');
      } else {
        outagesEl.closest('.ops-panel')?.classList.add('ops-hidden');
      }

      return {
        source: sourceLabel !== 'none' ? sourceLabel : 'board',
        stale: false,
      };
    });
  } catch (error) {
    setStatus(statusEl, error.message || 'Board failed', 'error');
  }
}

function schedule(ms) {
  if (timer) clearInterval(timer);
  health.setPollMs(ms);
  timer = setInterval(() => void load(), ms);
}

void (async () => {
  config = await fetchOpsConfig();
  if (!applyDeskViewability(config, 'board', statusEl)) return;
  schedule(intervalFor(config, 'board', 60_000));
  await load();
})();
