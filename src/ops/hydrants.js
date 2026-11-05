import { fetchHydrants } from './api.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
} from './shell.js';
import './ops.css';

mountOpsShell({ page: 'hydrants' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const radiusInput = document.querySelector('#radius');
const goBtn = document.querySelector('#go');
const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#list');
const nearestEl = document.querySelector('#nearest');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;
radiusInput.value = point.raw.get('radius_m') || '800';

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function writeUrl(lat, lon, radiusM) {
  const url = new URL(location.href);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('radius_m', String(radiusM));
  history.replaceState(null, '', url);
}

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const radiusM = Number(radiusInput.value) || 800;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus(statusEl, 'Enter a valid lat / lon', 'error');
    return;
  }
  goBtn.disabled = true;
  setStatus(statusEl, 'Loading hydrants…');
  try {
    const data = await fetchHydrants({ lat, lon, radiusM, limit: 60 });
    writeUrl(lat, lon, radiusM);
    const nearest = data.nearest;
    nearestEl.innerHTML = nearest
      ? `<dl class="ops-kv ops-grid">
          <div><dt>Distance</dt><dd>${esc(nearest.distanceM)} m</dd></div>
          <div><dt>Municipality</dt><dd>${esc(nearest.municipality || '—')}</dd></div>
          <div><dt>Color</dt><dd>${esc(nearest.color || '—')}</dd></div>
          <div><dt>Type</dt><dd>${esc(nearest.type || '—')}</dd></div>
          <div><dt>Lat / Lon</dt><dd>${esc(nearest.lat?.toFixed?.(5))}, ${esc(nearest.lon?.toFixed?.(5))}</dd></div>
        </dl>
        <p class="ops-note"><a href="/ops/place?lat=${lat}&lon=${lon}">Open Place size-up</a> · <a href="/ops/timeline?lat=${lat}&lon=${lon}">Then &amp; Now</a></p>`
      : '<p class="ops-note">No hydrant in radius.</p>';

    const rows = data.hydrants || [];
    listEl.innerHTML = rows.length
      ? `<ul class="ops-list">${rows
          .map((h) => {
            const dist =
              h.distanceM != null ? `${Math.round(h.distanceM)} m · ` : '';
            const meta = [h.municipality, h.color, h.type]
              .filter(Boolean)
              .map(esc)
              .join(' · ');
            return `<li>${esc(dist)}<a href="/ops/place?lat=${h.lat}&lon=${h.lon}">${esc(h.lat?.toFixed?.(5))}, ${esc(h.lon?.toFixed?.(5))}</a>${meta ? ` — ${meta}` : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="ops-note">Catalog empty for this search.</p>';

    setStatus(
      statusEl,
      `${rows.length} hydrant(s)${data.source ? ` · ${data.source}` : ''}${data.stale ? ' (stale)' : ''}`,
      'ok',
    );
  } catch (error) {
    setStatus(statusEl, error.message || 'Hydrant lookup failed', 'error');
  } finally {
    goBtn.disabled = false;
  }
}

goBtn.addEventListener('click', () => void load());
for (const el of [latInput, lonInput, radiusInput]) {
  el.addEventListener('keydown', (e) => e.key === 'Enter' && load());
}
void load();
