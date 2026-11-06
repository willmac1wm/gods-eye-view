import {
  capeGet,
  fetchManagerPath,
  fetchManagerSession,
  getManagerToken,
  setManagerToken,
} from './api.js';
import { OPS_PAGES } from './catalog.js';
import { fetchOpsConfig, saveOpsConfig, syncCapeStripPref } from './config.js';
import { GLOBE_VISIBILITY_MATRIX } from './globeLinks.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'managers' });

const tokenInput = document.querySelector('#token');
const signInBtn = document.querySelector('#sign-in');
const signOutBtn = document.querySelector('#sign-out');
const authStatus = document.querySelector('#auth-status');
const desk = document.querySelector('#desk');
const statusEl = document.querySelector('#status');
const outEl = document.querySelector('#out');
const appMapEl = document.querySelector('#app-map');
const healthEl = document.querySelector('#health');
const upstreamPanel = document.querySelector('#upstream');
const saveStatus = document.querySelector('#save-status');
const saveBtn = document.querySelector('#save-config');
const reloadBtn = document.querySelector('#reload-config');

tokenInput.value = getManagerToken();

const pageHealth = createPageHealth(ensureHealthHost(), {
  desk: 'managers',
  pollMs: 60_000,
});

/** Working copy edited in the form. */
let draft = null;

function checkGrid(container, map, prefix) {
  container.innerHTML = Object.keys(map)
    .map((key) => {
      const id = `${prefix}-${key}`;
      return `<label><input type="checkbox" id="${esc(id)}" data-map="${esc(prefix)}" data-key="${esc(key)}" ${map[key] ? 'checked' : ''}/> ${esc(key)}</label>`;
    })
    .join('');
}

function readCheckGrid(prefix, keys) {
  const out = {};
  for (const key of keys) {
    const el = document.getElementById(`${prefix}-${key}`);
    out[key] = Boolean(el?.checked);
  }
  return out;
}

function renderIntervals(intervals, clamps) {
  const host = document.querySelector('#intervals');
  host.innerHTML = Object.entries(intervals)
    .map(
      ([key, value]) => `
      <div class="ops-field">
        <label for="int-${esc(key)}">${esc(key)}</label>
        <input id="int-${esc(key)}" type="number" min="${clamps?.min || 15000}" max="${clamps?.max || 1800000}" step="1000" value="${esc(value)}" />
      </div>`,
    )
    .join('');
  document.querySelector('#interval-clamps').textContent = clamps
    ? `Clamped ${clamps.min}–${clamps.max} ms (place/hydrants min ${clamps.placeMin}; strip min ${clamps.stripMin}).`
    : '';
}

function readIntervals(keys) {
  const out = {};
  for (const key of keys) {
    const el = document.getElementById(`int-${key}`);
    out[key] = Number(el?.value);
  }
  return out;
}

function renderSources(sources) {
  const host = document.querySelector('#sources');
  host.innerHTML = `
    <div class="ops-row">
      <div class="ops-field">
        <label for="place-format">Place source format</label>
        <select id="place-format">
          <option value="native"${sources.place?.format !== 'firewire' ? ' selected' : ''}>Native NJ GIS compile</option>
          <option value="firewire"${sources.place?.format === 'firewire' ? ' selected' : ''}>Prefer Fire Wire place</option>
        </select>
      </div>
    </div>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">Place demo fixtures</h3>
    <div id="place-demo-sources" class="ops-check-grid"></div>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">LiveATC / ATC desk</h3>
    <div id="liveatc-sources" class="ops-check-grid"></div>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">LiveATC mounts</h3>
    <div id="liveatc-mounts" class="ops-check-grid"></div>
    <p class="ops-note">In-app Icecast proxy on <a href="/ops/atc">/ops/atc</a> (old Cape program). <code>links</code> = aviation external pages. Raw liveatc.net URLs stay blocked in RADIO.</p>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">Social / news collectors</h3>
    <div id="social-sources" class="ops-check-grid"></div>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">Board panels</h3>
    <div id="board-sources" class="ops-check-grid"></div>
  `;
  checkGrid(
    document.querySelector('#place-demo-sources'),
    { demoFixtures: Boolean(sources.place?.demoFixtures) },
    'placedemo',
  );
  checkGrid(
    document.querySelector('#liveatc-sources'),
    {
      links: sources.liveatc?.links !== false,
      proxy: sources.liveatc?.proxy !== false,
    },
    'liveatc',
  );
  checkGrid(
    document.querySelector('#liveatc-mounts'),
    sources.liveatc?.mounts || {
      kacy_a_twr: true,
      kwwd_twr: true,
      kmiv_awos: false,
    },
    'liveatcmount',
  );
  checkGrid(
    document.querySelector('#social-sources'),
    sources.social || {},
    'socialsrc',
  );
  checkGrid(
    document.querySelector('#board-sources'),
    sources.board || {},
    'boardsrc',
  );
}

function renderApprovals(approvals, permissions) {
  const host = document.querySelector('#approvals');
  const map = { ...approvals, ...permissions };
  checkGrid(host, map, 'appr');
}

function renderAi(ai) {
  const atc = ai?.atc || {};
  document.querySelector('#ai-fields').innerHTML = `
    <div class="ops-field" style="margin-bottom:0.75rem">
      <label for="ai-brief">Brief override</label>
      <textarea id="ai-brief">${esc(ai?.briefOverride || '')}</textarea>
    </div>
    <div class="ops-field" style="margin-bottom:0.75rem">
      <label for="ai-ask">Ask / HUD override</label>
      <textarea id="ai-ask">${esc(ai?.askOverride || '')}</textarea>
    </div>
    <h3 style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.75rem 0 0.4rem">ATC alert AI</h3>
    <label class="ops-check-grid" style="display:flex;margin-bottom:0.5rem"><input type="checkbox" id="atc-ai-enabled" ${atc.enabled !== false ? 'checked' : ''}/> Detect squawks / emergency / phraseology / call signs on ATC transcripts</label>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-lexicon">Emergency lexicon (comma-separated)</label>
      <textarea id="atc-lexicon">${esc((atc.emergencyLexicon || []).join(', '))}</textarea>
    </div>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-squawk">Squawk codes</label>
      <input id="atc-squawk" type="text" value="${esc((atc.squawkCodes || []).join(', '))}" />
    </div>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-phrase">Phraseology</label>
      <textarea id="atc-phrase">${esc((atc.phraseology || []).join(', '))}</textarea>
    </div>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-callsigns">Call sign watchlist</label>
      <textarea id="atc-callsigns">${esc((atc.callSigns || []).join(', '))}</textarea>
    </div>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-prompt">Detector prompt override</label>
      <textarea id="atc-prompt">${esc(atc.promptOverride || '')}</textarea>
    </div>
    <div class="ops-field" style="margin-bottom:0.5rem">
      <label for="atc-cooldown">Alert cooldown (sec)</label>
      <input id="atc-cooldown" type="number" min="5" max="3600" value="${esc(atc.cooldownSec ?? 60)}" />
    </div>
    <p class="ops-note">${esc(ai?.notes || '')}</p>
  `;
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function renderGlobeMatrix() {
  document.querySelector('#globe-matrix').innerHTML = `
    <table class="ops-matrix">
      <thead><tr><th>Desk</th><th>Strip</th><th>Layer</th><th>Handoff</th><th>Status</th></tr></thead>
      <tbody>
        ${GLOBE_VISIBILITY_MATRIX.map(
          (row) =>
            `<tr><td>${esc(row.desk)}</td><td>${esc(row.strip)}</td><td>${esc(row.layer)}</td><td>${esc(row.handoff)}</td><td>${esc(row.status)}</td></tr>`,
        ).join('')}
      </tbody>
    </table>`;
}

function renderAppMap() {
  appMapEl.innerHTML = listHtml([
    '<a href="/"><b>Globe</b></a> — heads-up CAD, CCTV, RADIO, Cape layers',
    ...OPS_PAGES.filter((p) => p.id !== 'hub' && p.id !== 'managers').map(
      (p) => `<a href="${p.href}"><b>${esc(p.title)}</b></a> — ${esc(p.blurb)}`,
    ),
  ]);
}

function paintForm(config) {
  draft = structuredClone(config);
  checkGrid(document.querySelector('#viewability'), draft.viewability, 'view');
  checkGrid(
    document.querySelector('#place-sections'),
    draft.placeSections,
    'place',
  );
  renderIntervals(draft.intervalsMs, draft.clamps);
  renderSources(draft.sources);
  renderApprovals(draft.approvals, draft.permissions);
  renderAi(draft.ai);
  renderGlobeMatrix();
  checkGrid(
    document.querySelector('#strip-sections'),
    draft.globe.stripSections,
    'strip',
  );
  checkGrid(
    document.querySelector('#globe-layers'),
    draft.globe.layers,
    'layer',
  );
  document.querySelector('#strip-enabled').checked = Boolean(
    draft.globe.stripEnabled,
  );
}

function collectForm() {
  const cfg = structuredClone(draft || {});
  cfg.viewability = readCheckGrid('view', Object.keys(cfg.viewability || {}));
  cfg.placeSections = readCheckGrid(
    'place',
    Object.keys(cfg.placeSections || {}),
  );
  cfg.intervalsMs = readIntervals(Object.keys(cfg.intervalsMs || {}));
  const placeDemo = readCheckGrid('placedemo', ['demoFixtures']);
  const liveFlags = readCheckGrid('liveatc', ['links', 'proxy']);
  cfg.sources = {
    place: {
      format: document.querySelector('#place-format')?.value || 'native',
      demoFixtures: Boolean(placeDemo.demoFixtures),
    },
    liveatc: {
      links: Boolean(liveFlags.links),
      proxy: Boolean(liveFlags.proxy),
      mounts: readCheckGrid(
        'liveatcmount',
        Object.keys(
          cfg.sources?.liveatc?.mounts || {
            kacy_a_twr: true,
            kwwd_twr: true,
            kmiv_awos: false,
          },
        ),
      ),
    },
    social: readCheckGrid('socialsrc', Object.keys(cfg.sources?.social || {})),
    board: readCheckGrid('boardsrc', Object.keys(cfg.sources?.board || {})),
  };
  const apprKeys = Object.keys({ ...cfg.approvals, ...cfg.permissions });
  const appr = readCheckGrid('appr', apprKeys);
  cfg.approvals = {
    requireManagerForMessages: Boolean(appr.requireManagerForMessages),
    requireConfirmAiOverrides: Boolean(appr.requireConfirmAiOverrides),
  };
  cfg.permissions = {
    canPostMessages: Boolean(appr.canPostMessages),
    canEditAiPrompts: Boolean(appr.canEditAiPrompts),
    canToggleGlobeLayers: Boolean(appr.canToggleGlobeLayers),
  };
  cfg.globe = {
    stripEnabled: Boolean(document.querySelector('#strip-enabled')?.checked),
    stripSections: readCheckGrid(
      'strip',
      Object.keys(cfg.globe?.stripSections || {}),
    ),
    layers: readCheckGrid('layer', Object.keys(cfg.globe?.layers || {})),
  };
  cfg.ai = {
    ...cfg.ai,
    briefOverride: document.querySelector('#ai-brief')?.value || '',
    askOverride: document.querySelector('#ai-ask')?.value || '',
    atc: {
      enabled: Boolean(document.querySelector('#atc-ai-enabled')?.checked),
      emergencyLexicon: splitCsv(document.querySelector('#atc-lexicon')?.value),
      squawkCodes: splitCsv(document.querySelector('#atc-squawk')?.value),
      phraseology: splitCsv(document.querySelector('#atc-phrase')?.value),
      callSigns: splitCsv(document.querySelector('#atc-callsigns')?.value),
      promptOverride: document.querySelector('#atc-prompt')?.value || '',
      cooldownSec: Number(document.querySelector('#atc-cooldown')?.value) || 60,
    },
  };
  return cfg;
}

async function renderHealth() {
  healthEl.innerHTML = note('Probing Cape / Fire Wire health…');
  const health = await capeGet('health/sources');
  if (!health || typeof health !== 'object') {
    healthEl.innerHTML = note(
      'Cape health unavailable — set FIREWIRE_URL or use globe strip Native fallbacks.',
    );
    return;
  }
  const rows = Object.entries(health).map(([key, source]) => {
    const state = source?.state || source?.status || '?';
    const age = source?.age_s != null ? `${source.age_s}s` : source?.age || '—';
    return [key, `${state} · age ${age}`];
  });
  healthEl.innerHTML =
    kv(rows.slice(0, 24)) +
    '<p class="ops-note"><a href="/ops/board">Board</a> · <a href="/ops/incidents">Incidents</a> · <a href="/ops/scanners">Scanners</a> · <a href="/ops/messages">Messages</a></p>';
}

async function refreshSession() {
  try {
    const session = await fetchManagerSession();
    if (!session.configured) {
      setStatus(
        authStatus,
        'Host missing CAPE_MANAGER_TOKEN — config saves stay local-only; Fire Wire tools locked',
        '',
      );
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    if (!session.authenticated) {
      setStatus(
        authStatus,
        'Locked — enter manager token to save config / Fire Wire tools',
        '',
      );
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    setStatus(
      authStatus,
      'Unlocked · config writes + Fire Wire proxy ready',
      'ok',
    );
    upstreamPanel.hidden = false;
    desk.hidden = false;
    return true;
  } catch (error) {
    if (error.status === 401) {
      setManagerToken('');
      tokenInput.value = '';
      setStatus(authStatus, 'Unauthorized — token rejected', 'error');
      upstreamPanel.hidden = true;
      desk.hidden = false;
      return false;
    }
    setStatus(authStatus, error.message || 'Session check failed', 'error');
    upstreamPanel.hidden = true;
    desk.hidden = false;
    return false;
  }
}

async function loadTool(path) {
  setStatus(statusEl, `Loading manager/${path}…`);
  outEl.textContent = '';
  try {
    const body = await fetchManagerPath(path);
    outEl.textContent =
      typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    setStatus(statusEl, `Ready · manager/${path}`, 'ok');
  } catch (error) {
    outEl.textContent = error.message || 'Request failed';
    setStatus(statusEl, error.message || 'Request failed', 'error');
    if (error.status === 401) {
      setManagerToken('');
      upstreamPanel.hidden = true;
      setStatus(authStatus, 'Session expired — unlock again', 'error');
    }
  }
}

async function loadConfig() {
  await pageHealth.probe(async () => {
    const config = await fetchOpsConfig({ force: true });
    paintForm(config);
    syncCapeStripPref(config);
    return { source: config.updatedAt ? 'server' : 'defaults', stale: false };
  });
}

signInBtn.addEventListener('click', async () => {
  setManagerToken(tokenInput.value.trim());
  const ok = await refreshSession();
  if (ok) void loadTool('status');
});

signOutBtn.addEventListener('click', () => {
  setManagerToken('');
  tokenInput.value = '';
  upstreamPanel.hidden = true;
  outEl.textContent = '';
  setStatus(authStatus, 'Locked — form still editable; save needs unlock', '');
});

upstreamPanel.addEventListener('click', (event) => {
  const btn = event.target?.closest?.('[data-mgr]');
  if (!btn) return;
  void loadTool(btn.getAttribute('data-mgr'));
});

saveBtn.addEventListener('click', async () => {
  const next = collectForm();
  if (
    next.approvals?.requireConfirmAiOverrides &&
    (next.ai?.briefOverride || next.ai?.askOverride) &&
    !window.confirm('Save AI prompt overrides into manager config?')
  ) {
    setStatus(saveStatus, 'Save cancelled', '');
    return;
  }
  setStatus(saveStatus, 'Saving…');
  try {
    const saved = await saveOpsConfig(next);
    paintForm(saved);
    syncCapeStripPref(saved);
    setStatus(saveStatus, `Saved · ${saved.updatedAt || 'ok'}`, 'ok');
  } catch (error) {
    setStatus(
      saveStatus,
      `${error.message || 'Save failed'} (local mirror updated if possible)`,
      'error',
    );
  }
});

reloadBtn.addEventListener('click', () => void loadConfig());

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signInBtn.click();
});

renderAppMap();
void renderHealth();
void loadConfig();
void (async () => {
  const ok = await refreshSession();
  if (ok) void loadTool('status');
})();
