/**
 * Shared plumbing for the Cape May County / South Jersey local-awareness
 * sources (NWS alerts, gauges, buoys, airports, outages, facilities, ...).
 *
 * Every source returns the same envelope so the browser can always show
 * where data came from, when it was updated and how trustworthy it is:
 *
 *   {
 *     source: { name, url?, license? },
 *     fetchedAt,                // ms: when THIS server last fetched it
 *     status,                   // 'live' | 'delayed' | 'unavailable'
 *     note?,                    // why delayed/unavailable, in plain words
 *     features: [ { id, geometry, title, kind, status, observedAt, ... } ],
 *     summary?
 *   }
 *
 * `status` describes the feed. Each feature may carry its own `status`
 * ('observed', 'forecast', 'estimated', 'not-reporting', 'unverified', ...).
 * A refresh that fails keeps the last good envelope and marks it delayed —
 * stale data is never relabelled as live.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SOUTH_JERSEY_BBOX = Object.freeze({
  west: -75.45,
  south: 38.85,
  east: -74.3,
  north: 39.75,
});

export const UA =
  'GodsEyeView/0.3 (Cape May County local situational awareness; contact via capemaydispatch.com)';

const CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'local');

export async function fetchJson(url, { headers = {}, timeoutMs = 20000, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    body,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

export async function fetchText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.text();
}

export function readDiskCache(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${name}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export function writeDiskCache(name, value) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(value));
  } catch (error) {
    console.warn('[Local] disk cache write failed:', name, error?.message);
  }
}

export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function inBox(lat, lon, box = SOUTH_JERSEY_BBOX) {
  return lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east;
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export async function overpass(query, timeoutMs = 90000) {
  let last;
  for (const endpoint of OVERPASS) {
    try {
      return await fetchJson(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeoutMs,
      });
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error('Overpass unavailable');
}

/**
 * One cached source. `load()` returns { features, summary?, note?, status? }.
 * `ttlMs` is how long a result is fresh; `staleAfterMs` is when a kept result
 * must be labelled delayed. `diskName` persists slow-changing data (OSM) so a
 * restart does not hit Overpass again.
 */
export function createSource({ name, source, ttlMs, staleAfterMs = ttlMs * 3, load, diskName }) {
  let envelope = null;
  let lastError = null;
  let inflight = null;
  if (diskName) {
    const disk = readDiskCache(diskName);
    if (disk?.features) envelope = disk;
  }

  async function refresh() {
    try {
      const result = await load();
      envelope = {
        source,
        fetchedAt: Date.now(),
        status: result.status || 'live',
        note: result.note || null,
        features: result.features || [],
        summary: result.summary || null,
      };
      lastError = null;
      if (diskName) writeDiskCache(diskName, envelope);
    } catch (error) {
      lastError = error?.message || String(error);
      console.warn(`[Local:${name}]`, lastError);
    }
  }

  async function get() {
    const fresh = envelope && Date.now() - envelope.fetchedAt < ttlMs;
    if (!fresh) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      // Wait only when there is nothing at all to serve.
      if (!envelope) await inflight;
    }
    if (!envelope) {
      return {
        source,
        fetchedAt: null,
        status: 'unavailable',
        note: lastError ? `Source unavailable: ${lastError}` : 'Source unavailable',
        features: [],
        summary: null,
      };
    }
    const age = Date.now() - envelope.fetchedAt;
    if (age > staleAfterMs || (lastError && age > ttlMs)) {
      return {
        ...envelope,
        status: envelope.status === 'unavailable' ? 'unavailable' : 'delayed',
        note:
          `Last successful update ${Math.round(age / 60000)} min ago` +
          (lastError ? ` — latest refresh failed (${lastError})` : ''),
      };
    }
    return envelope;
  }

  return { name, get };
}
