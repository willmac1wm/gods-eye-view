import { capeGet, fetchManagerPath } from './api.js';
import {
  applyDeskViewability,
  fetchOpsConfig,
  intervalFor,
} from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'firewire' });

const statusEl = document.querySelector('#status');
const atcHealthEl = document.querySelector('#atc-health');
const capeHealthEl = document.querySelector('#cape-health');
const outEl = document.querySelector('#out');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'firewire',
  pollMs: 60_000,
});

let config = null;
let timer = null;

async function fetchJson(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function load() {
  setStatus(statusEl, 'Loading Fire Wire control…');
  try {
    return await health.probe(async () => {
      const [atc, cape] = await Promise.all([
        fetchJson('/api/ops/atc/health'),
        capeGet('health/sources'),
      ]);

      atcHealthEl.innerHTML = atc
        ? kv([
            ['Proxy', atc.proxy ? 'on' : 'off'],
            ['Ingest env', atc.ingest ? 'ATC_LIVEATC_INGEST on' : 'off'],
            ['Mounts enabled', `${atc.enabled}/${atc.mounts}`],
            ['Transcript chunks', atc.chunks],
            [
              'Last probe',
              atc.probe?.at || '—',
            ],
          ]) +
          note(
            'LiveATC Icecast proxy is GEV-owned. Public-safety SDR audio still uses Fire Wire radio/live.',
          )
        : note('ATC health unavailable');

      if (cape && typeof cape === 'object') {
        capeHealthEl.innerHTML = listHtml(
          Object.entries(cape)
            .slice(0, 24)
            .map(([key, source]) => {
              const state = source?.state || source?.status || '?';
              const age =
                source?.age_s != null ? `${source.age_s}s` : source?.age || '—';
              return `<b>${esc(key)}</b> — ${esc(state)} · age ${esc(age)}`;
            }),
        );
      } else {
        capeHealthEl.innerHTML = note(
          'FIREWIRE_URL unset or Cape health offline — native flood/outages/board still work on /api/ops/*.',
        );
      }

      setStatus(
        statusEl,
        [
          atc ? 'ATC proxy' : null,
          cape ? 'Fire Wire health' : 'Fire Wire offline',
        ]
          .filter(Boolean)
          .join(' · '),
        atc || cape ? 'ok' : '',
      );
      return { source: 'ops-firewire', stale: !atc && !cape };
    });
  } catch (error) {
    setStatus(statusEl, error.message || 'Load failed', 'error');
    return { source: 'ops-firewire', stale: true };
  }
}

document.querySelectorAll('[data-path]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const path = btn.getAttribute('data-path');
    outEl.textContent = `Loading manager/${path}…`;
    try {
      const body = await fetchManagerPath(path);
      outEl.textContent =
        typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    } catch (error) {
      outEl.textContent =
        error.message ||
        'Manager tool failed — unlock token on /ops/managers first.';
    }
  });
});

function schedule(ms) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void load(), ms);
}

async function boot() {
  config = await fetchOpsConfig().catch(() => null);
  if (!applyDeskViewability(config, 'firewire', statusEl)) return;
  await load();
  schedule(intervalFor(config, 'firewire', 60_000));
}

void boot();
