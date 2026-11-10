/**
 * Local awareness shell: the shared details window, the active-alert chip
 * and the Local panel (Alerts · Calls · County · News · My Town · Report ·
 * Replay). Plain DOM, mounted once for the application lifetime.
 *
 * Every list shows its source, when it was updated and its status, and has
 * explicit loading, empty, delayed and error states.
 */
import * as Cesium from 'cesium';
import { fetchLocal } from './api.js';
import { initDetailsPanel, openRecord } from './detailsPanel.js';
import { escapeHtml, statusBadge, whenText, relativeTime, easternTime } from './format.js';
import {
  clearMyTown,
  getMyTown,
  locateNearMe,
  nearMyTown,
  setMyTown,
  setMyTownOptions,
  subscribeMyTown,
  townChoices,
} from './myTown.js';
import { LOCAL_LAYER_DEFINITIONS, atcRecord, callRecord } from '../layers/localFeatures/definitions.js';

const TABS = [
  ['alerts', 'Alerts'],
  ['calls', 'Calls'],
  ['county', 'County'],
  ['news', 'News'],
  ['town', 'My Town'],
  ['report', 'Report'],
  ['replay', 'Replay'],
];
const DEF = Object.fromEntries(LOCAL_LAYER_DEFINITIONS.map((d) => [d.id, d]));

let viewer = null;
let dataManager = null;
let panel = null;
let chip = null;
let activeTab = 'alerts';
let renderToken = 0;
let chipTimer = null;
let chipDismissedFor = null;
let replay = { audio: null, queue: [], index: -1 };
let callFilter = 'all';

const badge = (status) => {
  const b = statusBadge(status);
  return `<span class="gev-local-badge" data-tone="${b.tone}">${escapeHtml(b.text)}</span>`;
};

function metaLine(env) {
  const fetched = env.fetchedAt ? relativeTime(env.fetchedAt) : 'never';
  return `<div class="gev-local-meta">${badge(env.status)}<span>Source: ${escapeHtml(env.source?.name || 'unknown')}</span><span>Updated ${escapeHtml(fetched)}</span></div>${
    env.note ? `<p class="gev-local-note">${escapeHtml(env.note)}</p>` : ''
  }`;
}

const loadingHtml = (what) => `<div class="gev-local-empty" role="status">Loading ${escapeHtml(what)}…</div>`;
const errorHtml = (what, error) =>
  `<div class="gev-local-empty gev-local-error" role="alert">Could not load ${escapeHtml(what)}: ${escapeHtml(error?.message || 'unknown error')}.<br /><button type="button" class="gev-local-btn" data-act="retry" style="margin-top:10px">Try again</button></div>`;

function setLayer(id, on) {
  try {
    return dataManager?.setEnabled?.(id, on, { origin: 'user' });
  } catch {
    return null;
  }
}
const layerOn = (id) => Boolean(dataManager?.isEnabled?.(id));

function layerToggleHtml(id, label) {
  const on = layerOn(id);
  return `<button type="button" class="gev-local-btn${on ? ' is-active' : ''}" data-act="layer" data-layer="${id}" aria-pressed="${on}">${escapeHtml(on ? `${label}: on map` : `Show ${label} on map`)}</button>`;
}

// ------------------------------------------------------------------ tabs
async function renderAlerts(body, token) {
  body.innerHTML = loadingHtml('NWS alerts');
  const env = await fetchLocal('nws-alerts');
  if (token !== renderToken) return;
  const items = env.features;
  body.innerHTML = `${metaLine(env)}<div class="gev-local-chiprow">${layerToggleHtml('nws-alerts', 'alert areas')}</div>${
    env.status === 'unavailable'
      ? '<div class="gev-local-empty gev-local-error">NWS alerts are unavailable right now. Check weather.gov/phi directly.</div>'
      : items.length
        ? `<ul class="gev-local-list">${items
            .map(
              (a, i) => `<li><button type="button" class="gev-local-item" style="--item-accent:${escapeHtml(a.color)}" data-act="alert" data-i="${i}">
                <span class="gev-local-row"><strong>${escapeHtml(a.title)}</strong>${a.severity ? `<small>${escapeHtml(a.severity)}</small>` : ''}</span>
                <span>${escapeHtml(a.areaDesc || 'Area not stated')}</span>
                <small>Issued ${escapeHtml(easternTime(a.observedAt) || 'n/a')} · until ${escapeHtml(easternTime(a.expires) || 'not stated')}</small>
              </button></li>`,
            )
            .join('')}</ul>`
        : '<div class="gev-local-empty">No active NWS alerts for Cape May County, Delaware Bay or the nearby coastal waters.</div>'
  }`;
  body.onclick = (e) => {
    const el = e.target.closest('[data-act="alert"]');
    if (el) openRecord({ ...DEF['nws-alerts'].toRecord(items[+el.dataset.i], env), fetchedAt: env.fetchedAt });
  };
}

async function renderCalls(body, token) {
  body.innerHTML = loadingHtml('recent calls');
  const [atc, ps] = await Promise.all([
    fetchLocal('airport-radio').catch((e) => ({ status: 'unavailable', note: e.message, features: [], source: { name: 'Airport radio' } })),
    fetchLocal('public-safety-calls').catch((e) => ({ status: 'unavailable', note: e.message, features: [], source: { name: 'Fire Wire scanner' } })),
  ]);
  if (token !== renderToken) return;
  const rows = [
    ...ps.features.map((f) => ({ f, env: ps, kind: 'ps' })),
    ...atc.features.map((f) => ({ f, env: atc, kind: 'atc' })),
  ]
    .filter((r) => callFilter === 'all' || r.kind === callFilter)
    .sort((a, b) => String(b.f.observedAt).localeCompare(String(a.f.observedAt)));
  const chipBtn = (id, label) =>
    `<button type="button" class="gev-local-btn${callFilter === id ? ' is-active' : ''}" data-act="filter" data-filter="${id}" aria-pressed="${callFilter === id}">${label}</button>`;
  body.innerHTML = `
    <div class="gev-local-chiprow">${chipBtn('all', 'All')}${chipBtn('ps', 'Police · Fire · EMS')}${chipBtn('atc', 'Airport radio')}</div>
    <div class="gev-local-meta">${badge(ps.status)}<span>Police/Fire/EMS: ${escapeHtml(ps.source?.name || '')} · ${ps.features.length} in 48 h</span></div>
    ${ps.note ? `<p class="gev-local-note">${escapeHtml(ps.note)}</p>` : ''}
    <div class="gev-local-meta">${badge(atc.status)}<span>Airport radio: ${escapeHtml(atc.source?.name || '')} · updated ${escapeHtml(atc.fetchedAt ? relativeTime(atc.fetchedAt) : 'never')}</span></div>
    ${atc.note ? `<p class="gev-local-note">${escapeHtml(atc.note)}</p>` : ''}
    ${
      rows.length
        ? `<ul class="gev-local-list">${rows
            .slice(0, 80)
            .map(
              (r, i) => `<li><button type="button" class="gev-local-item" style="--item-accent:${escapeHtml(r.f.color || '#4cc9f0')}" data-act="call" data-i="${i}">
              <span class="gev-local-row"><strong>${escapeHtml(r.f.title)}</strong>${badge('transcribed')}${r.f.audio ? '<small>▶ audio</small>' : ''}</span>
              <span>${escapeHtml((r.kind === 'atc' ? r.f.transcript : r.f.summary || r.f.location) || 'No transcript')}</span>
              <small>${escapeHtml(whenText(r.f.observedAt) || 'time unknown')}</small>
            </button></li>`,
            )
            .join('')}</ul>`
        : '<div class="gev-local-empty">No calls to show for this filter.</div>'
    }`;
  body.onclick = (e) => {
    const filter = e.target.closest('[data-act="filter"]');
    if (filter) {
      callFilter = filter.dataset.filter;
      return show('calls');
    }
    const el = e.target.closest('[data-act="call"]');
    if (!el) return;
    const r = rows[+el.dataset.i];
    const record = r.kind === 'atc' ? atcRecord(r.f, r.env) : callRecord(r.f, r.env);
    openRecord({ ...record, fetchedAt: r.env.fetchedAt, lat: r.f.geometry?.lat, lon: r.f.geometry?.lon, flyHeight: 9000 });
  };
}

function card(title, m, inner) {
  return `<article class="gev-local-card"><h3><span>${escapeHtml(title)}</span>${badge(m.status)}</h3>${inner}<footer>${escapeHtml(m.source || 'unknown source')} · updated ${escapeHtml(m.updatedAgo || 'never')}${m.note ? ` · ${escapeHtml(m.note)}` : ''}</footer></article>`;
}

async function renderCounty(body, token) {
  body.innerHTML = loadingHtml('county conditions');
  const c = await fetchLocal('conditions');
  if (token !== renderToken) return;
  const town = getMyTown();
  const li = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const tides = c.floodGauges.tideStations
    .map((t) => `${escapeHtml(t.station)}: ${t.observedFtMLLW != null ? `<strong>${t.observedFtMLLW} ft</strong> observed` : 'no current observation from NOAA'}${t.nextTides[0] ? ` · next ${t.nextTides[0].type} ${t.nextTides[0].ft} ft at ${escapeHtml(easternTime(t.nextTides[0].time, { date: false }))} (predicted)` : ''}`);
  body.innerHTML = `
    <p class="gev-local-note">${escapeHtml(c.disclaimer)}</p>
    ${town.name ? `<div class="gev-local-meta"><span>My Town: ${escapeHtml(town.name)}</span></div>` : ''}
    <div class="gev-local-cards">
      ${card('NWS alerts', c.alerts, c.alerts.active.length ? li(c.alerts.active.map((a) => `<strong>${escapeHtml(a.event)}</strong> — until ${escapeHtml(easternTime(a.expires) || 'n/a')}`)) : '<p>No active alerts.</p>')}
      ${card('Tides & flood gauges', c.floodGauges, `<p>${c.floodGauges.reporting ?? '?'} gauges reporting. ${c.floodGauges.atOrAboveFloodStage.length ? `<strong>At or forecast above flood stage:</strong> ${c.floodGauges.atOrAboveFloodStage.map((g) => `${escapeHtml(g.gauge)} (${escapeHtml(g.category)}, ${g.observedNow ? 'observed now' : 'forecast'})`).join('; ')}` : 'None at or forecast above flood stage.'}</p>${li(tides)}`)}
      ${card('Predicted flooding (estimate)', { status: c.predictedFlooding.status, source: c.predictedFlooding.source, updatedAgo: c.floodGauges.updatedAgo }, `<p>${escapeHtml(c.predictedFlooding.anchors.length ? c.predictedFlooding.anchors.map((a) => `~${a.levelFt} ft above normal high tide near ${a.gauge}`).join('; ') : c.predictedFlooding.note)}</p>`)}
      ${card('Power outages', c.powerOutages, c.powerOutages.byCounty.length ? li(c.powerOutages.byCounty.map((k) => `${escapeHtml(k.county)}: <strong>${Number(k.out).toLocaleString('en-US')}</strong> customers out of ${Number(k.served || 0).toLocaleString('en-US')}`)) : '<p>No outage data.</p>')}
      ${card('Traffic incidents', c.trafficIncidents, `<p><strong>${c.trafficIncidents.count}</strong> crashes, closures and road works reported across Cape May, Atlantic and Cumberland counties.</p>`)}
      ${card('Marine', c.marine, li(c.marine.stations.map((s) => `${escapeHtml(s.station)}: ${s.status === 'observed' ? `waves ${s.waveHeightFt ?? 'n/a'} ft · water ${s.waterTempF ?? 'n/a'}°F · wind ${s.windKt ?? 'n/a'} kt` : 'not reporting'}`)))}
      ${card('Airport weather', c.airports, li(c.airports.local.map((a) => `${escapeHtml(a.airport)}: ${escapeHtml(a.category || 'n/a')} · wind ${a.windKt ?? 'n/a'}${a.gustKt ? `G${a.gustKt}` : ''} kt · ${a.tempF ?? 'n/a'}°F`)))}
      ${card('Rain radar', { status: 'reference', source: 'NOAA MRMS (map layer)', updatedAgo: 'see layer' }, `<p>${escapeHtml(c.radar.note)}</p>`)}
    </div>
    <div class="gev-local-chiprow" style="margin-top:10px">${['nws-alerts', 'tide-gauges', 'power-outages', 'traffic-incidents', 'emergency-facilities', 'marine-buoys', 'airport-weather'].map((id) => layerToggleHtml(id, DEF[id].name)).join('')}</div>`;
}

async function renderNews(body, token) {
  body.innerHTML = loadingHtml('local news');
  const env = await fetchLocal('local-news');
  if (token !== renderToken) return;
  body.innerHTML = `${metaLine(env)}${
    env.features.length
      ? `<ul class="gev-local-list">${env.features
          .map(
            (n) => `<li><a class="gev-local-item" href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(n.title)}</strong>
              <small>${escapeHtml(n.publisher)} (${escapeHtml(n.publisherKind)}) · ${escapeHtml(whenText(n.observedAt) || 'date unknown')} ↗</small>
            </a></li>`,
          )
          .join('')}</ul>`
      : '<div class="gev-local-empty">No local headlines in the last 14 days.</div>'
  }<p class="gev-local-note" style="margin-top:10px">Headlines link to the publisher. News reports are not verified by this app.</p>`;
}

function renderTown(body) {
  const town = getMyTown();
  body.innerHTML = `
    <p>${town.name ? `Your town is <strong>${escapeHtml(town.name)}</strong>${town.source === 'near-me' ? ' (nearest town to your location)' : ''}.` : 'Pick your town to focus the map and lists. It is saved on this device only.'}</p>
    <div class="gev-local-chiprow">
      <button type="button" class="gev-local-btn" data-act="near">📍 Near me</button>
      ${town.name ? '<button type="button" class="gev-local-btn is-quiet" data-act="clear">Clear my town</button>' : ''}
    </div>
    <p class="gev-local-status" role="status" aria-live="polite"></p>
    <div class="gev-local-chiprow">${townChoices()
      .map((t) => `<button type="button" class="gev-local-btn${town.name === t.name ? ' is-active' : ''}" data-act="pick" data-town="${escapeHtml(t.id)}" aria-pressed="${town.name === t.name}">${escapeHtml(t.name)}</button>`)
      .join('')}</div>
    ${
      town.name
        ? `<div class="gev-local-form">
        <label class="gev-local-check"><input type="checkbox" data-act="filter" ${town.filterMap ? 'checked' : ''} /> <span>Only show map items within the radius of my town (gauges, outages, incidents, facilities, buoys, airports, calls). Official NWS alerts are always shown.</span></label>
        <label>Radius <select data-act="radius">${[5, 8, 12, 20, 30].map((km) => `<option value="${km}" ${town.radiusKm === km ? 'selected' : ''}>${km} km (${Math.round(km * 0.621)} mi)</option>`).join('')}</select></label>
      </div>`
        : ''
    }
    <p class="gev-local-note" style="margin-top:12px">“Near me” asks your browser for your location once, uses it to pick the nearest town, and does not store or send your exact position.</p>`;
  const status = body.querySelector('.gev-local-status');
  body.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'pick') {
      const t = townChoices().find((x) => x.id === el.dataset.town);
      setMyTown(t);
      flyTo(t.lat, t.lon, 9000);
      renderTown(body);
    } else if (el.dataset.act === 'clear') {
      clearMyTown();
      renderTown(body);
    } else if (el.dataset.act === 'near') {
      status.textContent = 'Asking your browser for your location…';
      try {
        const t = await locateNearMe();
        setMyTown(t, 'near-me');
        flyTo(t.lat, t.lon, 9000);
        renderTown(body);
      } catch (error) {
        status.textContent = error.message;
      }
    }
  };
  body.onchange = (e) => {
    if (e.target.dataset.act === 'filter') setMyTownOptions({ filterMap: e.target.checked });
    if (e.target.dataset.act === 'radius') setMyTownOptions({ radiusKm: Number(e.target.value) });
  };
}

function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      // Re-encoding through a canvas also drops EXIF (including GPS) data.
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}

function mapCenter() {
  const canvas = viewer?.scene?.canvas;
  if (!canvas) return null;
  const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
  const carto = hit ? Cesium.Cartographic.fromCartesian(hit) : viewer.camera.positionCartographic;
  return carto ? { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) } : null;
}

async function renderReport(body) {
  const town = getMyTown();
  const config = await fetch('/api/local/report-config').then((r) => r.json()).catch(() => ({}));
  body.innerHTML = `
    <form class="gev-local-form" novalidate>
      <p class="gev-local-note"><strong>For emergencies call 911.</strong> This form does not reach dispatchers. Reports are saved <strong>privately</strong>, are <strong>not public</strong> until reviewed, and are never shown as confirmed facts.</p>
      <label>What are you seeing?
        <select name="category">
          <option value="flooding">Flooding / water on roads</option>
          <option value="road-hazard">Road hazard (tree, wires, debris)</option>
          <option value="power-out">Power out</option>
          <option value="storm-damage">Storm damage</option>
          <option value="fire-smoke">Fire or smoke</option>
          <option value="traffic">Traffic / crash</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label>Describe it (no names, phone numbers or other personal details)
        <textarea name="text" maxlength="1000" required placeholder="e.g. Water covering both lanes of Route 47 near Dennisville"></textarea>
      </label>
      <label>Town (optional)
        <select name="town"><option value="">Not given</option>${townChoices().map((t) => `<option ${town.name === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>
      </label>
      <label class="gev-local-check"><input type="checkbox" name="useCenter" /> <span>Attach the approximate spot at the center of the map (rounded to about 100 m). Your device location is not used.</span></label>
      <label>Photo (optional — resized on your device; location data inside the photo is removed)
        <input type="file" name="photo" accept="image/*" />
      </label>
      ${config.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(config.turnstileSiteKey)}"></div>` : ''}
      <label class="gev-hp">Leave this blank<input type="text" name="gev_hp" tabindex="-1" autocomplete="off" /></label>
      <button type="submit" class="gev-local-btn">Send report for review</button>
      <p class="gev-local-status" role="status" aria-live="polite"></p>
    </form>`;
  if (config.turnstileSiteKey && !document.querySelector('script[data-turnstile]')) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.dataset.turnstile = '1';
    document.head.appendChild(script);
  }
  const form = body.querySelector('form');
  const status = body.querySelector('.gev-local-status');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const text = String(data.get('text') || '').trim();
    if (text.length < 5) {
      status.textContent = 'Please describe what you are seeing.';
      return;
    }
    const payload = {
      category: data.get('category'),
      text,
      town: data.get('town') || null,
      gev_hp: data.get('gev_hp') || '',
      turnstileToken: form.querySelector('[name="cf-turnstile-response"]')?.value || '',
    };
    if (data.get('useCenter')) Object.assign(payload, mapCenter() || {});
    const file = data.get('photo');
    form.querySelector('[type=submit]').disabled = true;
    status.textContent = 'Sending…';
    try {
      if (file && file.size) payload.photo = await shrinkPhoto(file);
      const r = await fetch('/api/local/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      form.reset();
      status.textContent = j.message;
    } catch (error) {
      status.textContent = `Could not send: ${error.message}`;
    } finally {
      form.querySelector('[type=submit]').disabled = false;
    }
  };
}

async function renderReplay(body, token) {
  body.innerHTML = loadingHtml('recorded radio');
  const env = await fetchLocal('airport-radio');
  if (token !== renderToken) return;
  const clips = env.features.filter((f) => f.audio).sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  body.innerHTML = `${metaLine(env)}
    <p>Replay the most recent recorded Atlantic City tower radio in order (${clips.length} clips${clips.length ? `, ${escapeHtml(easternTime(clips[0].observedAt) || '')} to ${escapeHtml(easternTime(clips[clips.length - 1].observedAt, { date: false }) || '')}` : ''}).</p>
    <div class="gev-local-chiprow">
      <button type="button" class="gev-local-btn" data-act="play" ${clips.length ? '' : 'disabled'}>▶ Play in order</button>
      <button type="button" class="gev-local-btn is-quiet" data-act="stop">■ Stop</button>
    </div>
    <div class="gev-local-transcript"><span class="gev-local-label">Now playing</span><blockquote class="gev-replay-now">Nothing playing.</blockquote><small>Automatic transcripts may contain errors.</small></div>
    <p class="gev-local-note" style="margin-top:12px">Map layers with history (transit, weather radar, satellites) replay with the timeline bar at the bottom of the map. Police/fire/EMS call replay is unavailable while that scanner feed is offline.</p>
    ${clips.length ? '' : '<div class="gev-local-empty">No recorded clips available.</div>'}`;
  const now = body.querySelector('.gev-replay-now');
  const stop = () => {
    replay.audio?.pause();
    replay = { audio: null, queue: [], index: -1 };
  };
  const next = () => {
    replay.index += 1;
    const clip = replay.queue[replay.index];
    if (!clip) {
      now.textContent = 'Replay finished.';
      return stop();
    }
    now.textContent = `${easternTime(clip.observedAt) || ''} — ${clip.transcript || 'No transcript'}`;
    replay.audio = new Audio(clip.audio);
    replay.audio.onended = next;
    replay.audio.onerror = next;
    replay.audio.play().catch(() => {
      now.textContent = 'Your browser blocked audio playback. Press Play again.';
      stop();
    });
  };
  body.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') {
      stop();
      replay.queue = clips;
      next();
    } else if (act === 'stop') {
      stop();
      now.textContent = 'Stopped.';
    }
  };
}

const RENDERERS = { alerts: renderAlerts, calls: renderCalls, county: renderCounty, news: renderNews, town: renderTown, report: renderReport, replay: renderReplay };
const TAB_LABEL = Object.fromEntries(TABS);

function flyTo(lat, lon, height) {
  viewer?.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.8,
  });
}

async function show(tab) {
  activeTab = RENDERERS[tab] ? tab : 'alerts';
  const token = ++renderToken;
  replay.audio?.pause();
  panel.querySelector('.gev-local-tabs').innerHTML = TABS.map(
    ([id, label]) => `<button type="button" role="tab" class="gev-local-btn${id === activeTab ? ' is-active' : ''}" aria-selected="${id === activeTab}" data-tab="${id}">${label}</button>`,
  ).join('');
  const body = panel.querySelector('.gev-local-body');
  body.onclick = null;
  body.onchange = null;
  try {
    await RENDERERS[activeTab](body, token);
  } catch (error) {
    if (token !== renderToken) return;
    body.innerHTML = errorHtml(TAB_LABEL[activeTab], error);
    body.onclick = (e) => {
      if (e.target.closest('[data-act="retry"]')) show(activeTab);
    };
    return;
  }
}

export function openLocalPanel(tab) {
  if (!panel) return;
  panel.hidden = false;
  show(tab || activeTab);
  panel.querySelector('.gev-local-close')?.focus();
}

export function closeLocalPanel() {
  if (!panel) return;
  replay.audio?.pause();
  panel.hidden = true;
}

export function toggleLocalPanel() {
  if (!panel) return;
  if (panel.hidden) openLocalPanel();
  else closeLocalPanel();
}

async function refreshChip() {
  try {
    const env = await fetchLocal('nws-alerts');
    const top = env.features[0];
    if (!top || env.status === 'unavailable' || chipDismissedFor === top.id) {
      chip.hidden = true;
      return;
    }
    const more = env.features.length - 1;
    chip.style.setProperty('--chip-color', top.color);
    chip.innerHTML = `<span class="gev-local-chip-dot" aria-hidden="true"></span>
      <button type="button" class="gev-local-chip-main" data-act="open" title="Open NWS alerts">NWS · ${escapeHtml(top.title)}${top.expires ? ` until ${escapeHtml(easternTime(top.expires, { date: false }))}` : ''}${more > 0 ? ` · +${more} more` : ''}${env.status === 'delayed' ? ' · DELAYED' : ''}</button>
      <button type="button" data-act="dismiss" aria-label="Hide this alert banner">×</button>`;
    chip.dataset.top = top.id;
    chip.hidden = false;
  } catch {
    chip.hidden = true;
  }
}

/**
 * Mount the local shell.
 * @param {{viewer: Cesium.Viewer, dataManager: object}} options
 * @returns {() => void} destroy
 */
export function initLocalShell({ viewer: v, dataManager: dm }) {
  viewer = v;
  dataManager = dm;
  const destroyDetails = initDetailsPanel({ viewer });

  panel = document.createElement('section');
  panel.id = 'gev-local-main';
  panel.className = 'gev-local-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Local conditions');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="gev-local-head">
      <div class="gev-local-brand-wrap"><video class="gev-local-brand-logo" src="/logo-motion-square.mp4" poster="/logo.png" autoplay muted loop playsinline aria-hidden="true"></video><div><span class="gev-local-kicker">Cape May Dispatch · South Jersey</span><h2>Local conditions</h2></div></div>
      <button type="button" class="gev-local-close" aria-label="Close local conditions">×</button>
    </header>
    <div class="gev-local-tabs" role="tablist" aria-label="Local sections"></div>
    <div class="gev-local-body ui-scroll" role="tabpanel"></div>`;
  document.body.appendChild(panel);
  panel.querySelector('.gev-local-close').onclick = closeLocalPanel;
  panel.querySelector('.gev-local-tabs').onclick = (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) show(tab);
  };
  // "Show on map" toggles inside any tab.
  panel.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act="layer"]');
    if (!el) return;
    const id = el.dataset.layer;
    await setLayer(id, !layerOn(id));
    const on = layerOn(id);
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-pressed', String(on));
    el.textContent = on ? `${DEF[id]?.name || id}: on map` : `Show ${DEF[id]?.name || id} on map`;
  });
  const onKey = (e) => {
    if (e.key === 'Escape' && !panel.hidden && document.getElementById('gev-local-details')?.hidden !== false) closeLocalPanel();
  };
  document.addEventListener('keydown', onKey);

  chip = document.createElement('div');
  chip.id = 'gev-local-alert-chip';
  chip.setAttribute('role', 'status');
  chip.hidden = true;
  document.body.appendChild(chip);
  chip.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') openLocalPanel('alerts');
    if (act === 'dismiss') {
      chipDismissedFor = chip.dataset.top;
      chip.hidden = true;
    }
  };
  refreshChip();
  chipTimer = setInterval(refreshChip, 120000);
  const offTown = subscribeMyTown(() => {
    if (!panel.hidden && (activeTab === 'county' || activeTab === 'town')) show(activeTab);
  });
  // Used by nearMyTown-aware lists; referenced so bundlers keep the import.
  void nearMyTown;

  return () => {
    clearInterval(chipTimer);
    offTown();
    document.removeEventListener('keydown', onKey);
    destroyDetails();
    panel?.remove();
    chip?.remove();
    panel = chip = null;
  };
}
