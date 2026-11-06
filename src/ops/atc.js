import L from 'leaflet';
import { capeGet, fetchGnss } from './api.js';
import { applyDeskViewability, fetchOpsConfig, intervalFor } from './config.js';
import { globeHref } from './globeLinks.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
} from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';
import 'leaflet/dist/leaflet.css';

mountOpsShell({ page: 'atc' });

const statusEl = document.querySelector('#status');
const alertsEl = document.querySelector('#alerts');
const airEl = document.querySelector('#air');
const feedsEl = document.querySelector('#feeds');
const transcriptEl = document.querySelector('#transcript');
const player = document.querySelector('#player');
const chartVfrBtn = document.querySelector('#chart-vfr');
const chartIfrBtn = document.querySelector('#chart-ifr');

const point = parsePointParams();
const center = [
  Number.isFinite(point.lat) ? point.lat : OPS_HOME.lat,
  Number.isFinite(point.lon) ? point.lon : OPS_HOME.lon,
];

const health = createPageHealth(ensureHealthHost(), {
  desk: 'atc',
  pollMs: 15_000,
});

let config = null;
let timer = null;
let chartLayer = null;
let activeChart = 'vfr';

const map = L.map('atc-chart', {
  zoomControl: true,
  attributionControl: true,
}).setView(center, 9);

function chartUrl(layer) {
  return `/api/ops/atc/charts/${layer}/{z}/{y}/{x}`;
}

function setChart(layer) {
  activeChart = layer;
  if (chartLayer) map.removeLayer(chartLayer);
  chartLayer = L.tileLayer(chartUrl(layer), {
    maxZoom: 12,
    minZoom: 6,
    attribution: 'FAA charts via ArcGIS tiles · proxied by GEV',
  }).addTo(map);
  chartVfrBtn.setAttribute('aria-pressed', layer === 'vfr' ? 'true' : 'false');
  chartIfrBtn.setAttribute(
    'aria-pressed',
    layer === 'ifr_low' ? 'true' : 'false',
  );
}

chartVfrBtn.addEventListener('click', () => setChart('vfr'));
chartIfrBtn.addEventListener('click', () => setChart('ifr_low'));
setChart('vfr');

async function fetchJson(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function playMount(mount) {
  player.src = `/api/ops/atc/stream?mount=${encodeURIComponent(mount)}`;
  void player.play().catch(() => {});
}

function renderFeeds(feedsPayload) {
  const feeds = feedsPayload?.feeds || [];
  const linkOutOnly = feedsPayload?.policy === 'link_out_only';
  const block = feedsPayload?.block;
  if (!feeds.length) {
    feedsEl.innerHTML = note(
      'No ATC mounts configured — enable LiveATC proxy mounts in Managers.',
    );
    return;
  }
  const blockNote = linkOutOnly
    ? note(
        block
          ? `LiveATC blocked in-page proxy (HTTP ${esc(String(block.status))} ${esc(block.statusText || '')}). Exact body: ${esc(block.bodySnippet || '(empty)')}. Use external LiveATC links — not retrying rapidly.`
          : 'LiveATC proxy is link-out only (ToS / rate-limit). Use external LiveATC links.',
      )
    : '';
  feedsEl.innerHTML =
    blockNote +
    listHtml(
      feeds.map((f) => {
        const enabled = f.enabled !== false;
        const canListen = enabled && f.stream_url && !linkOutOnly;
        const listen = canListen
          ? `<button type="button" class="ops-btn atc-listen" data-mount="${esc(f.mount)}">Listen</button>`
          : enabled
            ? '<span class="ops-note">link-out only</span>'
            : '<span class="ops-note">disabled</span>';
        return (
          `<b>${esc(f.icao || f.feed_id)}</b> ${esc(f.name || '')} · ` +
          `${enabled ? (linkOutOnly ? 'external' : 'live') : 'off'} · ${listen}` +
          (f.search_url
            ? ` · <a href="${esc(f.search_url)}" target="_blank" rel="noopener">LiveATC page</a>`
            : '')
        );
      }),
    );
  feedsEl.querySelectorAll('.atc-listen').forEach((btn) => {
    btn.addEventListener('click', () => playMount(btn.dataset.mount));
  });
}

function renderTranscript(live) {
  const chunks = live?.chunks || [];
  const alerts = live?.alerts || [];
  if (alerts.length) {
    alertsEl.innerHTML =
      `<p class="atc-alert"><b>Alerts</b></p>` +
      listHtml(
        alerts
          .slice(0, 12)
          .map(
            (a) =>
              `<span class="atc-alert">${esc(a.kind)}</span> · ${esc(a.match)} · ${esc(a.mount || '')}`,
          ),
      );
  } else {
    alertsEl.innerHTML = note('No ATC alert hits in recent transcripts.');
  }

  if (!chunks.length) {
    transcriptEl.innerHTML = note(
      live?.quiet !== false
        ? 'Quiet — waiting on LiveATC audio / Whisper (proxy listen still works). With OPENAI_API_KEY the in-process loop fills this log; or POST /api/ops/atc/ingest.'
        : 'No chunks',
    );
    return;
  }
  transcriptEl.innerHTML = listHtml(
    chunks.map((c) => {
      const hit =
        Array.isArray(c.alerts) && c.alerts.length
          ? ` · <span class="atc-alert">${esc(c.alerts.map((a) => a.match).join(', '))}</span>`
          : '';
      return (
        `<b>${esc(c.mount)}</b> ${esc(c.started_at || '')}` +
        `<br/>${esc(c.transcript || '(no transcript)')}${hit}`
      );
    }),
  );
}

async function renderAir() {
  const [wx, tfrs, air, gnss] = await Promise.all([
    capeGet('airport_wx'),
    capeGet('aviation/tfrs'),
    capeGet('air'),
    fetchGnss({ lat: center[0], lon: center[1] }),
  ]);
  const airports = Array.isArray(wx)
    ? wx
    : wx?.airports || wx?.stations || wx?.items || [];
  const tfrList = Array.isArray(tfrs) ? tfrs : tfrs?.tfrs || tfrs?.items || [];
  airEl.innerHTML =
    kv([
      ['METAR stations', airports.length],
      ['TFRs', tfrList.length],
      ['Air snapshot', air ? 'ok' : '—'],
      ['GNSS', gnss ? 'ok' : '—'],
    ]) +
    listHtml([
      ...airports.slice(0, 12).map((a) => {
        const id = a.icao || a.id || a.station || 'APT';
        const cat = a.flight_category || a.flightCategory || a.cat || '';
        return `<b>${esc(id)}</b>${cat ? ` (${esc(cat)})` : ''}`;
      }),
      `<a href="${globeHref({
        lat: center[0],
        lon: center[1],
        layers: ['cape-airports', 'cape-tfrs'],
      })}">Open globe aviation layers</a>`,
      '<a href="/ops/aviation">Aviation desk (METAR detail)</a>',
      '<a href="/ops/firewire">Fire Wire control</a>',
    ]);
  return { airports: airports.length, tfrs: tfrList.length };
}

async function load() {
  setStatus(statusEl, 'Loading ATC desk…');
  try {
    return await health.probe(async () => {
      const proxyOn = config?.sources?.liveatc?.proxy !== false;
      const [feeds, live, airMeta] = await Promise.all([
        proxyOn
          ? fetchJson('/api/ops/atc/feeds')
          : Promise.resolve({ feeds: [] }),
        fetchJson('/api/ops/atc/live?limit=30'),
        renderAir(),
      ]);
      renderFeeds(feeds);
      renderTranscript(live);
      const enabled = (feeds?.feeds || []).filter((f) => f.enabled).length;
      const blocked = feeds?.policy === 'link_out_only' || live?.policy === 'link_out_only';
      setStatus(
        statusEl,
        [
          !proxyOn
            ? 'proxy off'
            : blocked
              ? `LiveATC blocked · HTTP ${feeds?.block?.status || live?.block?.status || '?'}`
              : `${enabled} mounts`,
          airMeta.airports ? `${airMeta.airports} METAR` : null,
          live?.chunks?.length
            ? `${live.chunks.length} transcripts`
            : 'quiet transcript',
          (live?.alerts || []).length ? `${live.alerts.length} alerts` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        blocked ? 'warn' : 'ok',
      );
      return {
        source: 'ops-atc',
        stale: false,
      };
    });
  } catch (error) {
    setStatus(statusEl, error.message || 'ATC load failed', 'error');
    return { source: 'ops-atc', stale: true };
  }
}

function schedule(ms) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void load(), ms);
}

async function boot() {
  config = await fetchOpsConfig().catch(() => null);
  if (!applyDeskViewability(config, 'atc', statusEl)) return;
  await load();
  schedule(intervalFor(config, 'atc', 15_000));
}

void boot();
