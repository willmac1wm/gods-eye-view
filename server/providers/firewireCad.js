// Fire Wire incidents for the cape-cad layer — a NEW integration, not a
// simple repoint. The old app's /api/cad/incidents served demo fixtures
// (CAD_INCIDENTS_CACHE, nearly empty); the true upstream is Fire Wire,
// which has no /api/cad/* routes. It has /api/incidents — published,
// transcribed scanner incidents with coordinates, priority, and audio.
//
// This provider fetches Fire Wire /api/incidents and maps each row to
// the shape src/layers/capeDispatch/model.js mapCad() already consumes
// ({ incidents: [...] }), so the layer, the status strip CAD section,
// and the county call counts all read the same live incidents.
//
// Sensitive incidents are dropped server-side: the public globe never
// receives them (the old site stripped them for non-master audiences
// the same way). Audio URLs are Fire Wire /audio/{filename} paths; the
// client rewrites them onto the same-origin cape proxy.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { resolveCapeUpstream } from './capeUpstream.js';

const INCIDENTS_LIMIT = 50;
const CACHE_MS = 60_000; // 1 minute; the layer polls every 60 s anyway
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/**
 * One Fire Wire /api/incidents row -> the mapCad() incident shape.
 * Null when the row has no usable coordinates or is sensitive.
 */
export function mapFireWireIncident(row) {
  if (!row || row.sensitive === true) return null;
  // Number(null) is 0 — reject missing/blank coordinates before converting.
  const lat = row.lat == null || row.lat === '' ? NaN : Number(row.lat);
  const lng = row.lng == null || row.lng === '' ? NaN : Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let units = [];
  try {
    const parsed = JSON.parse(row.known_units || '[]');
    if (Array.isArray(parsed)) units = parsed.map(String);
  } catch {
    units = [];
  }
  return {
    id: row.id,
    type: row.incident_type || 'Incident',
    nature: row.incident_type || null,
    location: row.location || null,
    address: row.location || null,
    municipality: row.municipality || null,
    status: row.status || null,
    priority: row.priority || null,
    timestamp: row.created_at || row.last_transmission_at || null,
    time: row.created_at || null,
    lat,
    lng,
    audio_url: row.audio_url || null,
    summary: row.public_summary || null,
    description: row.public_summary || null,
    units,
  };
}

const DEFAULT_FIREWIRE_BASE = 'http://127.0.0.1:8000';

export async function fetchFireWireIncidents({
  fetchImpl = (...args) => globalThis.fetch(...args),
  baseUrl,
  limit = INCIDENTS_LIMIT,
} = {}) {
  const base = baseUrl ?? resolveCapeUpstream();
  if (!base) return { configured: false, incidents: [] };
  const pathAndQuery = `/api/incidents?limit=${encodeURIComponent(String(limit))}`;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response = await fetchImpl(`${base}${pathAndQuery}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (
    response.status === 404 &&
    baseUrl === undefined &&
    base !== DEFAULT_FIREWIRE_BASE
  ) {
    response = await fetchImpl(`${DEFAULT_FIREWIRE_BASE}${pathAndQuery}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
  }
  if (!response.ok) throw new Error(`firewire_upstream_${response.status}`);
  const payload = await readResponseJsonCapped(
    response,
    MAX_RESPONSE_BYTES,
    signal,
  );
  const rows = Array.isArray(payload) ? payload : [];
  return {
    configured: true,
    incidents: rows.map(mapFireWireIncident).filter(Boolean),
  };
}

export function firewireCadProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const base = resolveCapeUpstream();
    if (!base) {
      return json(200, {
        configured: false,
        incidents: [],
        error: null,
      });
    }
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) {
      return json(200, { configured: true, incidents: cache.incidents });
    }
    try {
      if (!inflight)
        inflight = load().finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, { configured: true, incidents: cache.incidents });
    } catch (error) {
      if (cache) {
        return json(200, {
          configured: true,
          incidents: cache.incidents,
          stale: true,
        });
      }
      return json(502, {
        configured: true,
        error: 'firewire_cad_unavailable',
        detail: String(error?.message || error),
      });
    }

    async function load() {
      const result = await fetchFireWireIncidents({ fetchImpl, baseUrl: base });
      return { incidents: result.incidents, fetched_at: now() };
    }
  }

  return {
    name: 'firewire-cad',
    configureServer({ middlewares }) {
      middlewares.use('/api/firewire-cad', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/firewire-cad', handler);
    },
  };
}
