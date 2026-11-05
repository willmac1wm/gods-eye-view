import { capeGet, fetchFloodZone } from './api.js';
import { globeHref } from './globeLinks.js';
import { startLiveDesk } from './liveDesk.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
  writePointUrl,
} from './shell.js';
import { esc, kv, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'flood' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const zoneBtn = document.querySelector('#zone-go');
const zoneEl = document.querySelector('#zone');
const statusEl = document.querySelector('#status');
const watchEl = document.querySelector('#watch');
const gaugesEl = document.querySelector('#gauges');
const stormsEl = document.querySelector('#storms');
const sarEl = document.querySelector('#sar');
const toolsEl = document.querySelector('#tools');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;

async function lookupZone() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  writePointUrl(lat, lon);
  zoneEl.innerHTML = '<p class="ops-note">Looking up…</p>';
  const zone = await fetchFloodZone({ lat, lon });
  if (!zone) {
    zoneEl.innerHTML =
      '<p class="ops-note">Flood zone unavailable (Fire Wire tool or FEMA).</p>';
    return;
  }
  zoneEl.innerHTML = kv([
    ['Zone', zone.zone],
    ['Subtype', zone.subtype],
    ['SFHA', zone.sfha ? 'yes' : 'no'],
    ['Static BFE', zone.staticBfe],
    ['Source', zone.source],
  ]);
}

async function load() {
  setStatus(statusEl, 'Loading flood desk…');
  const [watch, gauges, storms, sar, plan] = await Promise.all([
    capeGet('floodwatch'),
    capeGet('flood_gauges'),
    capeGet('storms'),
    capeGet('sar/flood'),
    capeGet('flood_map/plan'),
  ]);
  watchEl.innerHTML = watch
    ? kv([
        ['Station', watch.station_name],
        ['Level (ft)', watch.level_ft],
        ['Category', watch.category],
        ['Flooding now', watch.flooding_now ? 'yes' : 'no'],
        ['Trend ft/hr', watch.trend_ft_per_hr],
      ])
    : '<p class="ops-note">Floodwatch unavailable</p>';

  const gaugeList = Array.isArray(gauges)
    ? gauges
    : gauges?.gauges || gauges?.features || [];
  gaugesEl.innerHTML = listHtml(
    gaugeList.slice(0, 40).map((g) => {
      const name = g.name || g.title || g.id || 'Gauge';
      const level = g.level_ft ?? g.value ?? g.obs;
      const cat = g.category || g.status || '';
      const lat = Number(g.lat ?? g.latitude);
      const lon = Number(g.lon ?? g.lng ?? g.longitude);
      const link =
        Number.isFinite(lat) && Number.isFinite(lon)
          ? ` · <a href="/ops/place?lat=${lat}&lon=${lon}">Place</a>`
          : '';
      return `<b>${esc(name)}</b>${level != null ? ` — ${esc(level)} ft` : ''}${cat ? ` (${esc(cat)})` : ''}${link}`;
    }),
  );

  const stormList = storms?.storms || [];
  stormsEl.innerHTML = listHtml(
    stormList.slice(0, 12).map((s) => {
      const peak = s.peak_ft != null ? `${s.peak_ft} ft` : '';
      return `${esc(s.id || s.peak_time || 'storm')}: ${esc(s.category || '')} ${esc(peak)} (${esc(s.start || '')} → ${esc(s.end || '')})`;
    }),
  );

  sarEl.innerHTML = sar
    ? kv([
        ['Configured', sar.configured ? 'yes' : 'no'],
        ['Available', sar.available ? 'yes' : 'no'],
        ['Latest pass', sar.latest_pass],
        ['New water %', sar.new_water_pct],
        ['Error', sar.error],
      ])
    : '<p class="ops-note">SAR unavailable</p>';

  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  toolsEl.innerHTML = listHtml([
    plan
      ? `Flood map plan — flooding predicted: <b>${esc(String(Boolean(plan.flooding)))}</b>; max ${esc(plan.max_level ?? 0)} ft`
      : 'Flood map plan unavailable',
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `<a href="${globeHref({ lat, lon, layers: ['cape-flood', 'cape-nws'] })}">Open globe flood + NWS layers</a>`
      : '<a href="/?v=2&l=04.05">Open globe flood + NWS layers</a>',
    'Flood3D / waterline packs: <code>/api/cape/flood3d/…</code> when Fire Wire publishes them',
    'Point tool: use Lookup above (FEMA NFHL native, Fire Wire flood-zone when configured)',
  ]);

  setStatus(
    statusEl,
    [
      watch ? 'floodwatch' : null,
      gaugeList.length ? `${gaugeList.length} gauges` : null,
      stormList.length ? `${stormList.length} storms` : null,
      sar?.available ? 'SAR' : null,
    ]
      .filter(Boolean)
      .join(' · ') || 'quiet / Fire Wire offline',
    watch || gaugeList.length ? 'ok' : '',
  );

  return {
    source: watch ? 'floodwatch' : 'cape/flood',
    stale: !watch && !gaugeList.length,
  };
}

zoneBtn.addEventListener('click', () => void lookupZone());
void lookupZone();
void startLiveDesk('flood', load, { defaultMs: 60_000 });
