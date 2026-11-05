import { capeGet } from './api.js';
import { mountOpsShell, parsePointParams, setStatus } from './shell.js';
import { esc, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'reconstruct' });

const statusEl = document.querySelector('#status');
const incidentsEl = document.querySelector('#incidents');
const workspaceEl = document.querySelector('#workspace');
const params = parsePointParams();
const incidentId = params.raw.get('incident') || '';

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.incidents || payload?.calls || payload?.items || [];
}

async function load() {
  setStatus(statusEl, 'Staging reconstruct desk…');
  const incidents = asList(await capeGet('cad/incidents'));
  const calls = asList(await capeGet('cad/calls'));
  const rows = [...incidents, ...calls];

  incidentsEl.innerHTML = listHtml(
    rows.slice(0, 40).map((item) => {
      const id = item.id || item.incident_id || item.call_id || '';
      const title = item.title || item.type || item.nature || id || 'Incident';
      const lat = Number(item.lat ?? item.latitude);
      const lon = Number(item.lon ?? item.lng ?? item.longitude);
      const q = new URLSearchParams({ incident: id });
      if (Number.isFinite(lat)) q.set('lat', String(lat));
      if (Number.isFinite(lon)) q.set('lon', String(lon));
      return `<a href="/ops/reconstruct?${q}"><b>${esc(title)}</b></a>${id ? ` · ${esc(id)}` : ''}`;
    }),
  );

  if (incidentId) {
    workspaceEl.innerHTML = `
      ${note(`Selected incident: ${incidentId}`)}
      <ul class="ops-list">
        <li>Track packs / WAMI frames attach when Fire Wire publishes reconstruct assets for this id.</li>
        <li><a href="/ops/incidents">Back to Incidents</a></li>
        <li><a href="/?${params.lat != null ? `lat=${params.lat}&lon=${params.lon}` : ''}">Open scene on globe</a></li>
        <li>Director / Bhote-style 4D replay uses the same GEV scene engine once a Cape pack is authored.</li>
      </ul>`;
    setStatus(statusEl, `Replay workspace · ${incidentId}`, 'ok');
  } else {
    workspaceEl.innerHTML = note(
      'Pick an incident above (or deep-link ?incident=) to stage a 4D replay. This replaces old /reconstruct and /replay.',
    );
    setStatus(
      statusEl,
      rows.length
        ? `${rows.length} CAD row(s) available to replay`
        : 'Waiting on Fire Wire CAD / reconstruct packs',
      rows.length ? 'ok' : '',
    );
  }
}

void load();
