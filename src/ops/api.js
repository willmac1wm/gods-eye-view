/** Same-origin ops compile APIs + Fire Wire Cape proxy helpers. */
async function readJson(path, { soft = false } = {}) {
  const response = await fetch(path);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    if (soft) return null;
    const detail = body?.error || body?.detail || response.statusText;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return body;
}

export function fetchPlace({ lat, lon }) {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return readJson(`/api/ops/place?${q}`);
}

export function fetchHydrants({ lat, lon, radiusM = 800, limit = 40 } = {}) {
  const q = new URLSearchParams();
  if (Number.isFinite(lat)) q.set('lat', String(lat));
  if (Number.isFinite(lon)) q.set('lon', String(lon));
  if (Number.isFinite(radiusM)) q.set('radius_m', String(radiusM));
  if (Number.isFinite(limit)) q.set('limit', String(limit));
  return readJson(`/api/ops/hydrants?${q}`);
}

export function fetchHydrantPinpoint({ lat, lon, hint = '' } = {}) {
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  if (hint) q.set('hint', hint);
  return readJson(`/api/ops/hydrants/pinpoint?${q}`);
}

export function fetchFloodZone({ lat, lon }) {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return readJson(`/api/ops/flood-zone?${q}`, { soft: true });
}

export function fetchTimelineMeta() {
  return readJson('/api/ops/timeline/eras');
}

export function timelineImageUrl({ era, lat, lon, size = 640 }) {
  const q = new URLSearchParams({
    era: String(era),
    lat: String(lat),
    lon: String(lon),
    size: String(size),
  });
  return `/api/ops/timeline/image?${q}`;
}

export function fetchWhales() {
  return readJson('/api/ops/whales');
}

export function fetchGnss({ lat, lon } = {}) {
  const q = new URLSearchParams();
  if (Number.isFinite(lat)) q.set('lat', String(lat));
  if (Number.isFinite(lon)) q.set('lon', String(lon));
  const suffix = q.toString() ? `?${q}` : '';
  return readJson(`/api/gnss-integrity${suffix}`, { soft: true });
}

/** Fire Wire / Cape allowlisted GETs via same-origin proxy. Soft on failure. */
export function capeGet(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return readJson(`/api/cape/${clean}`, { soft: true });
}

export async function parseKmlOrKmz(file) {
  const form = new FormData();
  form.append('file', file, file.name || 'upload.kml');
  const response = await fetch('/api/ops/intel/kml', {
    method: 'POST',
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.detail || `HTTP ${response.status}`);
  }
  return body;
}

export function fetchSocial({ kind } = {}) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return readJson(`/api/ops/social${q}`);
}

export function fetchNews() {
  return fetchSocial({ kind: 'news' });
}

export function fetchMessages() {
  return readJson('/api/ops/messages');
}

export async function postMessage({ from, text }) {
  const token = getManagerToken();
  const response = await fetch('/api/ops/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ from, text }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(
      body?.error || body?.detail || `HTTP ${response.status}`,
    );
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function fetchOpsManagerConfig() {
  return readJson('/api/ops/manager/config', { soft: true });
}

const MANAGER_TOKEN_KEY = 'gev.cape.managerToken';

export function getManagerToken() {
  try {
    return sessionStorage.getItem(MANAGER_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setManagerToken(token) {
  try {
    if (token) sessionStorage.setItem(MANAGER_TOKEN_KEY, token);
    else sessionStorage.removeItem(MANAGER_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function managerFetch(path, { soft = false } = {}) {
  const token = getManagerToken();
  const response = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    if (soft) return null;
    const detail = body?.error || body?.detail || response.statusText;
    const err = new Error(detail || `HTTP ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function fetchManagerSession() {
  return managerFetch('/api/ops/manager/session', { soft: false });
}

export function fetchManagerPath(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return managerFetch(`/api/ops/manager/${clean}`);
}
