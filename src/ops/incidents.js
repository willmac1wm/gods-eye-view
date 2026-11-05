import { capeGet } from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml, fmtWhen } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'incidents' });

const statusEl = document.querySelector('#status');
const incidentsEl = document.querySelector('#incidents');
const callsEl = document.querySelector('#calls');
const unitsEl = document.querySelector('#units');

function rowIncident(item) {
  const id = item.id || item.incident_id || item.call_id || '';
  const title = item.title || item.type || item.nature || item.summary || id || 'Incident';
  const lat = Number(item.lat ?? item.latitude);
  const lon = Number(item.lon ?? item.lng ?? item.longitude);
  const where = item.address || item.location || '';
  const when = fmtWhen(item.updated_at || item.time || item.started_at);
  const links = [];
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    links.push(
      `<a href="/ops/place?lat=${lat}&lon=${lon}">Place</a>`,
      `<a href="/ops/reconstruct?incident=${encodeURIComponent(id)}&lat=${lat}&lon=${lon}">Replay</a>`,
      `<a href="/?lat=${lat}&lon=${lon}">Globe</a>`,
    );
  } else if (id) {
    links.push(
      `<a href="/ops/reconstruct?incident=${encodeURIComponent(id)}">Replay</a>`,
    );
  }
  return `<b>${esc(title)}</b>${where ? ` — ${esc(where)}` : ''}${when ? ` · ${esc(when)}` : ''}${links.length ? ` · ${links.join(' · ')}` : ''}`;
}

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.incidents)) return payload.incidents;
  if (Array.isArray(payload?.calls)) return payload.calls;
  if (Array.isArray(payload?.units)) return payload.units;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function load() {
  setStatus(statusEl, 'Loading CAD…');
  const [incidents, calls, units] = await Promise.all([
    capeGet('cad/incidents'),
    capeGet('cad/calls'),
    capeGet('cad/units'),
  ]);
  if (!incidents && !calls && !units) {
    setStatus(
      statusEl,
      'Fire Wire CAD offline / unconfigured — set FIREWIRE_URL',
      'error',
    );
    incidentsEl.innerHTML = listHtml([]);
    callsEl.innerHTML = listHtml([]);
    unitsEl.innerHTML = listHtml([]);
    return;
  }
  const inc = asList(incidents);
  const callRows = asList(calls);
  const unitRows = asList(units);
  incidentsEl.innerHTML = listHtml(inc.slice(0, 40).map(rowIncident));
  callsEl.innerHTML = listHtml(callRows.slice(0, 40).map(rowIncident));
  unitsEl.innerHTML = listHtml(
    unitRows.slice(0, 40).map((u) => {
      const name = u.unit || u.name || u.id || 'Unit';
      const status = u.status || u.state || '';
      return `${esc(name)}${status ? ` — ${esc(status)}` : ''}`;
    }),
  );
  setStatus(
    statusEl,
    `${inc.length} incident(s) · ${callRows.length} call(s) · ${unitRows.length} unit(s)`,
    'ok',
  );
}

void load();
setInterval(load, 60_000);
