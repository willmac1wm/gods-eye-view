import { capeGet } from './api.js';
import { packsByKind } from './fixtures/capePacks.js';
import { globeHref } from './globeLinks.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, parsePointParams, setStatus } from './shell.js';
import { esc, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'reconstruct' });

const statusEl = document.querySelector('#status');
const incidentsEl = document.querySelector('#incidents');
const workspaceEl = document.querySelector('#workspace');
const packsEl = document.querySelector('#packs');
const params = parsePointParams();
const incidentId = params.raw.get('incident') || '';

const health = createPageHealth(ensureHealthHost(), {
  desk: 'reconstruct',
  pollMs: 120_000,
});

function asList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.incidents || payload?.calls || payload?.items || [];
}

function renderStarterPacks() {
  if (!packsEl) return;
  const packs = packsByKind('reconstruct').concat(packsByKind('scene'));
  packsEl.innerHTML = listHtml(
    packs.map((pack) => {
      const globe = globeHref({
        lat: pack.lat,
        lon: pack.lon,
        layers: [...pack.layers],
      });
      const assets =
        pack.assets?.length > 0
          ? `${pack.assets.length} asset(s)`
          : 'author assets empty';
      return (
        `<b>${esc(pack.title)}</b> · ${esc(pack.id)} · ${esc(pack.status)} · ${esc(assets)}` +
        ` · <a href="${globe}">Globe deep-link</a>` +
        (pack.note ? `<br/><span class="ops-note">${esc(pack.note)}</span>` : '')
      );
    }),
  );
}

async function load() {
  setStatus(statusEl, 'Staging reconstruct desk…');
  renderStarterPacks();
  await health.probe(async () => {
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
      const lat = params.lat;
      const lon = params.lon;
      const globe = globeHref({
        lat,
        lon,
        layers: ['cape-cad', 'cape-cameras', 'cape-radio'],
      });
      workspaceEl.innerHTML = `
      ${note(`Selected incident: ${incidentId}`)}
      <ul class="ops-list">
        <li>Track packs / WAMI frames attach when Fire Wire publishes reconstruct assets for this id.</li>
        <li>Author assets: empty until a Cape pack is published (starter shells listed below).</li>
        <li><a href="/ops/incidents">Back to Incidents</a></li>
        <li><a href="${globe}">Open scene on globe</a></li>
        <li>Director / Bhote-style 4D replay uses the same GEV scene engine once a Cape pack is authored.</li>
      </ul>`;
      setStatus(statusEl, `Replay workspace · ${incidentId}`, 'ok');
    } else {
      workspaceEl.innerHTML = note(
        'Pick an incident above (or deep-link ?incident=) to stage a 4D replay. Starter pack shells load without error; author assets stay empty until published.',
      );
      setStatus(
        statusEl,
        rows.length
          ? `${rows.length} CAD row(s) available to replay`
          : 'Waiting on Fire Wire CAD · starter packs ready',
        rows.length ? 'ok' : '',
      );
    }
    return {
      source: rows.length ? 'cape/cad' : 'starter-packs',
      stale: !rows.length,
    };
  });
}

void load();
