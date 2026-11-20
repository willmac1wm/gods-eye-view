// Fire Wire scanner feeds for the cape-radio layer — a NEW integration,
// not a simple repoint. The old app's /api/radio/feeds listed Broadcastify
// feeds with liveness from chunk files on local disk; Fire Wire has no
// /api/radio/* routes. It has /api/snapshot, whose audio_feeds carry the
// same feed ids with last-chunk timestamps — the liveness signal.
//
// This provider keeps the old app's curated 8-feed table (names, agency,
// description, primary flag) and merges Fire Wire snapshot liveness onto
// it, returning the shape src/layers/capeDispatch/model.js mapRadio()
// already consumes ({ feeds: [...] }).
//
// A channel is live only while its newest chunk is still this fresh
// (180 s — chunks are about 30 s; the old LIVE_CHUNK_MAX_AGE_S). The
// snapshot's LiveATC Atlantic City (KACY) feed is deliberately excluded:
// /ops/atc already handles LiveATC listening separately.
//
// Known gap (documented, not hidden): per-feed chunk playback. The old
// app served chunk files from disk (/api/radio/buffer, /seek, /live);
// Fire Wire exposes clips as /audio/{filename} via the cape proxy and
// its /api/transmissions carry no audio URLs, so there is no feed ->
// recent-clip mapping yet. The layer pins + liveness are live; the
// radio panel's chunk scrubber still waits on that mapping.
import { readResponseJsonCapped } from './common/http.js';
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { resolveCapeUpstream } from './capeUpstream.js';

const CACHE_MS = 30_000; // 30 s; liveness is the whole point here
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const LIVE_CHUNK_MAX_AGE_S = 180;

/** Curated Cape May County public safety and emergency feeds (old radio.py). */
export const RADIO_FEEDS = Object.freeze([
  Object.freeze({
    feed_id: 37982,
    source_id: 3,
    name: 'Cape May County Public Safety',
    agency: 'County Dispatch',
    desc: 'Fire, EMS, and County-wide Emergency Dispatch',
    is_primary: true,
  }),
  Object.freeze({
    feed_id: 17999,
    source_id: 17,
    name: 'Middle Township Volunteer Fire',
    agency: 'Middle Twp Fire',
    desc: 'Middle Township Fire & Rescue Ops',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 18044,
    source_id: 7,
    name: 'Ocean City Fire Rescue',
    agency: 'Ocean City',
    desc: 'Ocean City Fire Department and Marine Ops',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 24350,
    source_id: 27,
    name: 'Middle Township Ambulance',
    agency: 'Middle Twp EMS',
    desc: 'Emergency Medical Services & Ambulances',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 24689,
    source_id: 30,
    name: 'Rio Grande Fire',
    agency: 'Rio Grande Fire',
    desc: 'Rio Grande Volunteer Fire Company',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 22200,
    source_id: 16,
    name: 'Lower Township Fire Dispatch',
    agency: 'Lower Twp Fire',
    desc: 'Lower Township Fire & Emergency Ops',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 13632,
    source_id: 6,
    name: 'Atlantic & Cape May Counties - Southern',
    agency: 'Regional Mutual Aid',
    desc: 'South Jersey Regional Fire & EMS',
    is_primary: false,
  }),
  Object.freeze({
    feed_id: 13481,
    source_id: 33,
    name: 'NJ State Police Troop C',
    agency: 'NJSP Troop C',
    desc: 'State Police Highway Patrol (GSP & Route 55)',
    is_primary: false,
  }),
]);

// Fire Wire's last_chunk_at is MAX(AudioChunk.created_at). That column is a
// SQLAlchemy DateTime stamped with datetime.utcnow(), so it holds UTC with
// no zone, and Python's isoformat() sends it with no offset:
// "2026-11-16T11:59:00.529993" (no fraction when microseconds are 0; a
// raw SQLite string would use a space instead of the T). Fire Wire's own
// _to_utc_dt reads such values as UTC. JavaScript's Date.parse reads a
// date-time with no zone as LOCAL time, so on a US Eastern host (Legion)
// every chunk was placed 4-5 hours in the future, far outside the 120 s
// skew allowance, and no feed was ever live. This parser reads a zoneless
// value as UTC and honours an explicit Z or offset, so the answer is the
// same in every TZ.
const SNAPSHOT_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Parse a Fire Wire snapshot timestamp to epoch seconds, or null when it
 * is not an ISO 8601 date-time. A value with no zone designator is UTC
 * (see above), never local time.
 */
export function snapshotTimestampToEpoch(value) {
  if (typeof value !== 'string') return null;
  const match = SNAPSHOT_TIMESTAMP.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1) return null;
  // Date.UTC (and Date.parse) roll 2026-02-31 or T24:00 over into the next
  // day; this parser is deliberately stricter and rejects them.
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes = 0;
  if (zone && zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    const zoneHours = Number(digits.slice(0, 2));
    const zoneMinutes = Number(digits.slice(2) || '0');
    if (zoneHours > 23 || zoneMinutes > 59) return null;
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (zoneHours * 60 + zoneMinutes);
  }
  const ms = Number(frac.slice(0, 3).padEnd(3, '0'));
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) -
    offsetMinutes * 60_000;
  return Number.isFinite(utcMs) ? Math.floor(utcMs / 1000) : null;
}

/** True when a chunk timestamp is recent enough to be on-air audio. */
export function chunkIsLive(epoch, nowEpoch, maxAgeS = LIVE_CHUNK_MAX_AGE_S) {
  const now =
    nowEpoch != null ? Number(nowEpoch) : Math.floor(Date.now() / 1000);
  try {
    const age = now - Number(epoch);
    return age >= -120 && age <= maxAgeS;
  } catch {
    return false;
  }
}

/**
 * Merge Fire Wire /api/snapshot audio_feeds onto the curated table.
 * Snapshot rows keyed by feed_id; a feed with no snapshot row (or no
 * chunk ever) reports has_audio false and live false.
 */
export function mapSnapshotFeeds(snapshot, nowEpoch = null) {
  const now = nowEpoch != null ? nowEpoch : Math.floor(Date.now() / 1000);
  const byFeedId = new Map();
  for (const row of snapshot?.audio_feeds || []) {
    if (row?.feed_id != null) byFeedId.set(Number(row.feed_id), row);
  }
  return RADIO_FEEDS.map((feed) => {
    const row = byFeedId.get(Number(feed.feed_id));
    const lastChunkAt = row?.last_chunk_at || null;
    const lastEpoch = lastChunkAt
      ? snapshotTimestampToEpoch(lastChunkAt)
      : null;
    return {
      ...feed,
      has_audio: lastChunkAt != null,
      last_heard_at: lastChunkAt,
      last_filename: null,
      live: lastEpoch != null && chunkIsLive(lastEpoch, now),
    };
  });
}

const DEFAULT_FIREWIRE_BASE = 'http://127.0.0.1:8000';

export function firewireRadioProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 60, globalMax: 600 });
  let cache = null;
  let cacheAt = 0;
  let inflight = null;

  async function load(base) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let response = await fetchImpl(`${base}/api/snapshot`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404 && base !== DEFAULT_FIREWIRE_BASE) {
      response = await fetchImpl(`${DEFAULT_FIREWIRE_BASE}/api/snapshot`, {
        signal,
        headers: { Accept: 'application/json' },
      });
    }
    if (!response.ok) throw new Error(`firewire_upstream_${response.status}`);
    const snapshot = await readResponseJsonCapped(
      response,
      MAX_RESPONSE_BYTES,
      signal,
    );
    return {
      feeds: mapSnapshotFeeds(snapshot, Math.floor(now() / 1000)),
      fetched_at: now(),
    };
  }

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
        feeds: RADIO_FEEDS.map((feed) => ({
          ...feed,
          has_audio: false,
          last_heard_at: null,
          last_filename: null,
          live: false,
        })),
        error: null,
      });
    }
    const t = now();
    if (cache && t - cacheAt < CACHE_MS) {
      return json(200, { configured: true, feeds: cache.feeds });
    }
    try {
      if (!inflight)
        inflight = load(base).finally(() => {
          inflight = null;
        });
      cache = await inflight;
      cacheAt = Date.now();
      return json(200, { configured: true, feeds: cache.feeds });
    } catch (error) {
      if (cache) {
        return json(200, {
          configured: true,
          feeds: cache.feeds,
          stale: true,
        });
      }
      return json(502, {
        configured: true,
        error: 'firewire_radio_unavailable',
        detail: String(error?.message || error),
      });
    }
  }

  return {
    name: 'firewire-radio',
    configureServer({ middlewares }) {
      middlewares.use('/api/firewire-radio', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/firewire-radio', handler);
    },
  };
}
