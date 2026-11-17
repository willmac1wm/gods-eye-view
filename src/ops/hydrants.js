import { fetchHydrantPinpoint, fetchHydrants } from './api.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
  writePointUrl,
} from './shell.js';
import { esc, kv } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'hydrants' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const radiusInput = document.querySelector('#radius');
const hintInput = document.querySelector('#hint');
const goBtn = document.querySelector('#go');
const pinpointBtn = document.querySelector('#pinpoint');
const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#list');
const nearestEl = document.querySelector('#nearest');
const pinpointOut = document.querySelector('#pinpoint-out');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;
radiusInput.value = point.raw.get('radius_m') || '800';

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
    writePointUrl(lat, lon, { radius_m: radiusM });
    const nearest = data.nearest;
    nearestEl.innerHTML = nearest
      ? `${kv([
          ['Distance', `${nearest.distanceM} m`],
          ['Municipality', nearest.municipality],
          ['Color', nearest.color],
          ['Type', nearest.type],
          [
            'Lat / Lon',
            `${nearest.lat?.toFixed?.(5)}, ${nearest.lon?.toFixed?.(5)}`,
          ],
        ])}<p class="ops-note"><a href="/ops/place?lat=${lat}&lon=${lon}">Open Place size-up</a> · <a href="/ops/timeline?lat=${lat}&lon=${lon}">Then &amp; Now</a></p>`
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

async function pinpoint() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus(statusEl, 'Enter a valid lat / lon', 'error');
    return;
  }
  pinpointBtn.disabled = true;
  pinpointOut.innerHTML = '<p class="ops-note">Pinpointing…</p>';
  try {
    const data = await fetchHydrantPinpoint({
      lat,
      lon,
      hint: hintInput.value.trim(),
    });
    const pick = data.pinpoint;
    pinpointOut.innerHTML = pick
      ? kv([
          ['Confidence', data.confidence],
          ['Method', data.method],
          ['Distance', pick.distanceM != null ? `${pick.distanceM} m` : null],
          ['Municipality', pick.municipality],
          ['Color', pick.color],
          ['Lat / Lon', `${pick.lat?.toFixed?.(5)}, ${pick.lon?.toFixed?.(5)}`],
          ['Note', data.note],
        ])
      : '<p class="ops-note">No pinpoint candidate</p>';
  } catch (error) {
    pinpointOut.innerHTML = `<p class="ops-note">${esc(error.message || 'Pinpoint failed')}</p>`;
  } finally {
    pinpointBtn.disabled = false;
  }
}

goBtn.addEventListener('click', () => void load());
pinpointBtn.addEventListener('click', () => void pinpoint());
for (const el of [latInput, lonInput, radiusInput]) {
  el.addEventListener('keydown', (e) => e.key === 'Enter' && load());
}
void load();
