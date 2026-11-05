/** Same-origin ops compile APIs. */
async function readJson(path) {
  const response = await fetch(path);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const detail = body?.error || body?.detail || response.statusText;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return body;
}

export function fetchPlace({ lat, lon }) {
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
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
