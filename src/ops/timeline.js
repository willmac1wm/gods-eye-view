import { fetchTimelineMeta, timelineImageUrl } from './api.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
} from './shell.js';
import './ops.css';

mountOpsShell({ page: 'timeline' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const thenSelect = document.querySelector('#then-era');
const nowSelect = document.querySelector('#now-era');
const goBtn = document.querySelector('#go');
const statusEl = document.querySelector('#status');
const thenImg = document.querySelector('#then-img');
const nowImg = document.querySelector('#now-img');
const thenCap = document.querySelector('#then-cap');
const nowCap = document.querySelector('#now-cap');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;

function writeUrl(lat, lon, thenEra, nowEra) {
  const url = new URL(location.href);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('a', thenEra);
  url.searchParams.set('b', nowEra);
  history.replaceState(null, '', url);
}

function fillSelect(select, eras, preferred) {
  select.innerHTML = eras
    .map(
      (era) =>
        `<option value="${era.id}"${era.id === preferred ? ' selected' : ''}>${era.label}</option>`,
    )
    .join('');
}

async function boot() {
  setStatus(statusEl, 'Loading eras…');
  try {
    const meta = await fetchTimelineMeta();
    const eras = meta.eras || [];
    const preferredThen =
      point.raw.get('a') || meta.defaults?.then || eras[0]?.id;
    const preferredNow =
      point.raw.get('b') ||
      meta.defaults?.now ||
      eras[eras.length - 1]?.id;
    fillSelect(thenSelect, eras, preferredThen);
    fillSelect(nowSelect, eras, preferredNow);
    setStatus(statusEl, 'Ready', 'ok');
    await load();
  } catch (error) {
    setStatus(statusEl, error.message || 'Timeline meta failed', 'error');
  }
}

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const thenEra = thenSelect.value;
  const nowEra = nowSelect.value;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus(statusEl, 'Enter a valid lat / lon', 'error');
    return;
  }
  if (!thenEra || !nowEra) {
    setStatus(statusEl, 'Select Then and Now eras', 'error');
    return;
  }
  goBtn.disabled = true;
  setStatus(statusEl, 'Fetching imagery…');
  try {
    const thenUrl = timelineImageUrl({ era: thenEra, lat, lon, size: 720 });
    const nowUrl = timelineImageUrl({ era: nowEra, lat, lon, size: 720 });
    const bust = `t=${Date.now()}`;
    thenImg.src = `${thenUrl}&${bust}`;
    nowImg.src = `${nowUrl}&${bust}`;
    thenCap.textContent = thenSelect.selectedOptions[0]?.text || thenEra;
    nowCap.textContent = nowSelect.selectedOptions[0]?.text || nowEra;
    writeUrl(lat, lon, thenEra, nowEra);
    await Promise.all([
      thenImg.decode().catch(() => {}),
      nowImg.decode().catch(() => {}),
    ]);
    setStatus(statusEl, 'Then & Now ready · NJGIN orthophotos', 'ok');
  } catch (error) {
    setStatus(statusEl, error.message || 'Imagery failed', 'error');
  } finally {
    goBtn.disabled = false;
  }
}

goBtn.addEventListener('click', () => void load());
thenSelect.addEventListener('change', () => void load());
nowSelect.addEventListener('change', () => void load());
for (const el of [latInput, lonInput]) {
  el.addEventListener('keydown', (e) => e.key === 'Enter' && load());
}
void boot();
