import { fetchWhales } from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'whales' });

const statusEl = document.querySelector('#status');
const zonesEl = document.querySelector('#zones');

async function load() {
  setStatus(statusEl, 'Loading NARW zones…');
  try {
    const data = await fetchWhales();
    zonesEl.innerHTML = listHtml(
      (data.zones || []).map((z) => {
        const link =
          Number.isFinite(z.lat) && Number.isFinite(z.lon)
            ? ` · <a href="/?lat=${z.lat}&lon=${z.lon}">Globe</a>`
            : '';
        const detail = (z.details || []).map(esc).join(' · ');
        return `<b>${esc(z.title)}</b>${detail ? ` — ${detail}` : ''}${link}`;
      }),
    );
    setStatus(
      statusEl,
      `${data.count || 0} zone(s) · ${data.source || 'nmfs'}${data.stale ? ' (stale)' : ''}`,
      'ok',
    );
  } catch (error) {
    setStatus(statusEl, error.message || 'Whale zones unavailable', 'error');
    zonesEl.innerHTML = listHtml([]);
  }
}

void load();
