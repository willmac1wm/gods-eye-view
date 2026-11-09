/**
 * Scanner calls from the local Fire Wire transcription service.
 *
 *   GET /api/scanner/calls?hours=48   → { calls: [...], fetchedAt }
 *   GET /api/scanner/audio/<file>.mp3 → the call's audio clip
 *
 * Fire Wire runs beside this server (FIREWIRE_URLS, comma-separated, or
 * FIREWIRE_URL; default http://127.0.0.1:8000) and is never exposed directly.
 * Calls Fire Wire marks sensitive are dropped here and never reach a browser,
 * and only the public summary is passed on — never the raw transcript. Calls
 * without a real location are dropped rather than pinned to a default point.
 */

const CACHE_MS = 30 * 1000;
const MAX_HOURS = 168;
const AUDIO_FILE = /^[A-Za-z0-9_-]{1,120}\.mp3$/;

function firewireBases() {
  const list = String(process.env.FIREWIRE_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const single = String(process.env.FIREWIRE_URL || 'http://127.0.0.1:8000').trim();
  return (list.length ? list : [single]).map((b) => b.replace(/\/+$/, ''));
}

function parseUnits(raw) {
  if (Array.isArray(raw)) return raw.map(String).slice(0, 12);
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 12) : [];
  } catch {
    return [];
  }
}

/**
 * Airport radio (air traffic control) vs police / fire / EMS. Fire Wire
 * records both; they are shown as separate layers.
 */
export function classifyCall(inc, audioFile = '') {
  const type = String(inc?.incident_type || '');
  const where = String(inc?.location || '');
  if (
    /^ATC\b|air traffic|tower clearance|approach control/i.test(type) ||
    /^kacy[_-]/i.test(audioFile) ||
    /\(K[A-Z]{3}\)|international airport|intl airport/i.test(where)
  )
    return 'aviation';
  return 'public-safety';
}

/** Public-safe call records. */
export function normalizeFirewireIncidents(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.incidents;
  if (!Array.isArray(rows)) return null;
  const calls = [];
  for (const inc of rows) {
    if (!inc || inc.sensitive) continue;
    const lat = Number(inc.lat);
    const lon = Number(inc.lng ?? inc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0))
      continue;
    const audioFile = String(inc.audio_url || '').split('/').pop();
    const createdMs = Date.parse(String(inc.created_at || '') + (/[zZ+]/.test(String(inc.created_at || '').slice(-6)) ? '' : 'Z'));
    if (!Number.isFinite(createdMs)) continue;
    calls.push({
      id: String(inc.id ?? `${lat},${lon},${createdMs}`),
      type: String(inc.incident_type || 'General Dispatch').trim(),
      priority: ['high', 'medium', 'low', 'routine'].includes(inc.priority)
        ? inc.priority
        : 'medium',
      location: String(inc.location || '').trim(),
      municipality: String(inc.municipality || '').trim(),
      lat,
      lon,
      createdMs,
      summary: String(inc.public_summary || '').trim(),
      units: parseUnits(inc.known_units),
      transmissions: Number(inc.transmission_count) || null,
      audio: AUDIO_FILE.test(audioFile) ? `/api/scanner/audio/${audioFile}` : null,
      category: classifyCall(inc, audioFile),
    });
  }
  return calls.sort((a, b) => b.createdMs - a.createdMs);
}

export function scannerProxy({ fetchImpl = fetch } = {}) {
  const cache = new Map(); // hours → {at, body}

  async function fetchFirst(pathAndQuery) {
    let lastError = null;
    for (const base of firewireBases()) {
      try {
        const response = await fetchImpl(`${base}${pathAndQuery}`, {
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        if (response.ok) return response;
        lastError = new Error(`Fire Wire HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Fire Wire unavailable');
  }

  function install(server) {
    server.middlewares.use('/api/scanner', async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const json = (status, body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'GET') return json(405, { error: 'GET only' });

      if (url.pathname === '/calls') {
        const hours = Math.max(
          1,
          Math.min(MAX_HOURS, Math.floor(Number(url.searchParams.get('hours')) || 48)),
        );
        const category = url.searchParams.get('category');
        const pick = (body) =>
          category === 'aviation' || category === 'public-safety'
            ? { ...body, calls: body.calls.filter((c) => c.category === category) }
            : body;
        const hit = cache.get(hours);
        if (hit && Date.now() - hit.at < CACHE_MS) return json(200, pick(hit.body));
        try {
          const response = await fetchFirst(`/api/incidents?hours=${hours}`);
          const calls = normalizeFirewireIncidents(await response.json());
          if (!calls) return json(502, { error: 'Malformed Fire Wire response' });
          const body = { calls, fetchedAt: Date.now() };
          cache.set(hours, { at: Date.now(), body });
          return json(200, pick(body));
        } catch (error) {
          if (hit) return json(200, pick(hit.body));
          return json(503, { error: 'Scanner feed unavailable' });
        }
      }

      const audio = /^\/audio\/([^/]+)$/.exec(url.pathname);
      if (audio && AUDIO_FILE.test(audio[1])) {
        try {
          const response = await fetchFirst(`/audio/${audio[1]}`);
          const type = response.headers.get('content-type') || 'audio/mpeg';
          if (!/^audio\//i.test(type)) return json(502, { error: 'Not audio' });
          const body = Buffer.from(await response.arrayBuffer());
          if (body.length > 20 * 1024 * 1024) return json(502, { error: 'Clip too large' });
          res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': body.length,
            'Cache-Control': 'public, max-age=3600',
          });
          return res.end(body);
        } catch {
          return json(404, { error: 'Clip unavailable' });
        }
      }
      return json(404, { error: 'Not found' });
    });
  }

  return {
    name: 'scanner-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}
