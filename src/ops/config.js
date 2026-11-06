/**
 * Manager config client — server store under /api/ops/manager/config with
 * localStorage fallback for GEV-local prefs when the host is unreachable.
 */
import { getManagerToken } from './api.js';

const LOCAL_KEY = 'gev.cape.managerConfig';
const CACHE_TTL_MS = 30_000;

let memory = null;
let memoryAt = 0;

const FALLBACK = Object.freeze({
  version: 1,
  viewability: {},
  placeSections: {
    parcel: true,
    occupancy: true,
    construction: true,
    flood: true,
    hydrant: true,
    codeEnforcement: true,
    cityMaps: true,
  },
  intervalsMs: {
    place: 300_000,
    social: 60_000,
    news: 90_000,
    board: 60_000,
    incidents: 60_000,
    scanners: 60_000,
    flood: 60_000,
    cameras: 120_000,
    aviation: 120_000,
    whales: 300_000,
    messages: 15_000,
    strip: 60_000,
  },
  sources: {
    social: { board: true, social: true, news: true, wire: true },
    place: { format: 'native' },
    board: { official: true, newsWire: true, county: true, outages: true },
  },
  globe: {
    stripEnabled: true,
    stripSections: {},
    layers: {},
  },
  approvals: {
    requireManagerForMessages: false,
    requireConfirmAiOverrides: true,
  },
  permissions: {
    canPostMessages: true,
    canEditAiPrompts: true,
    canToggleGlobeLayers: true,
  },
  ai: { briefOverride: '', askOverride: '', notes: '' },
  updatedAt: null,
});

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocal(config) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(config));
  } catch {
    /* ignore quota */
  }
}

function mergeFallback(config) {
  return {
    ...FALLBACK,
    ...config,
    intervalsMs: { ...FALLBACK.intervalsMs, ...config?.intervalsMs },
    viewability: { ...FALLBACK.viewability, ...config?.viewability },
    placeSections: { ...FALLBACK.placeSections, ...config?.placeSections },
    sources: {
      social: { ...FALLBACK.sources.social, ...config?.sources?.social },
      place: { ...FALLBACK.sources.place, ...config?.sources?.place },
      board: { ...FALLBACK.sources.board, ...config?.sources?.board },
    },
    globe: {
      ...FALLBACK.globe,
      ...config?.globe,
      stripSections: {
        ...FALLBACK.globe.stripSections,
        ...config?.globe?.stripSections,
      },
      layers: { ...FALLBACK.globe.layers, ...config?.globe?.layers },
    },
    approvals: { ...FALLBACK.approvals, ...config?.approvals },
    permissions: { ...FALLBACK.permissions, ...config?.permissions },
    ai: { ...FALLBACK.ai, ...config?.ai },
  };
}

/** Fetch manager config (cached briefly). Soft-fails to localStorage / defaults. */
export async function fetchOpsConfig({ force = false } = {}) {
  const t = Date.now();
  if (!force && memory && t - memoryAt < CACHE_TTL_MS) return memory;
  try {
    const response = await fetch('/api/ops/manager/config');
    if (response.ok) {
      const body = await response.json();
      memory = mergeFallback(body.config || body);
      memoryAt = t;
      writeLocal(memory);
      return memory;
    }
  } catch {
    /* fall through */
  }
  const local = readLocal();
  memory = mergeFallback(local || FALLBACK);
  memoryAt = t;
  return memory;
}

/** Persist config (requires manager token). Also mirrors to localStorage. */
export async function saveOpsConfig(config, { method = 'PUT' } = {}) {
  const token = getManagerToken();
  const response = await fetch('/api/ops/manager/config', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ config }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    // Still stash locally so GEV-local prefs survive offline edits.
    writeLocal(mergeFallback(config));
    const err = new Error(
      body?.error || body?.detail || `HTTP ${response.status}`,
    );
    err.status = response.status;
    err.body = body;
    throw err;
  }
  memory = mergeFallback(body.config || config);
  memoryAt = Date.now();
  writeLocal(memory);
  return memory;
}

export function intervalFor(config, key, fallbackMs = 60_000) {
  const n = Number(config?.intervalsMs?.[key]);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

export function deskVisible(config, deskId) {
  if (!config?.viewability) return true;
  if (config.viewability[deskId] === false) return false;
  return true;
}

export function placeSectionVisible(config, sectionId) {
  if (!config?.placeSections) return true;
  if (config.placeSections[sectionId] === false) return false;
  return true;
}

/** Apply nav visibility from manager config (hide desk links when off). */
export function applyNavViewability(config) {
  const nav = document.querySelector('.ops-nav');
  if (!nav || !config?.viewability) return;
  for (const link of nav.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    const id = href.replace(/^\/ops\/?/, '').replace(/\/$/, '') || 'hub';
    const deskId = id === '' ? 'hub' : id;
    if (config.viewability[deskId] === false) {
      link.hidden = true;
      link.setAttribute('aria-hidden', 'true');
    } else {
      link.hidden = false;
      link.removeAttribute('aria-hidden');
    }
  }
}

/**
 * Gate the current desk body when Managers viewability turns it off.
 * Nav already hides the link; this stops the page from looking "live".
 * Returns false when the desk should not poll / load.
 */
export function applyDeskViewability(config, deskId, statusEl) {
  const visible = deskVisible(config, deskId);
  const main = document.querySelector('.ops-main');
  if (main) {
    main.classList.toggle('ops-desk-hidden', !visible);
  }
  if (!visible && statusEl) {
    statusEl.textContent = `${deskId} desk hidden by Managers viewability`;
    statusEl.dataset.tone = 'error';
  }
  return visible;
}

/** Sync Cape strip localStorage flag from manager globe.stripEnabled. */
export function syncCapeStripPref(config) {
  try {
    if (config?.globe?.stripEnabled === false) {
      localStorage.setItem('gev.cape', 'off');
    } else if (config?.globe?.stripEnabled === true) {
      localStorage.removeItem('gev.cape');
    }
  } catch {
    /* ignore */
  }
}

export { FALLBACK as OPS_CONFIG_FALLBACK };
