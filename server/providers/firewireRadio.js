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
    let lastEpoch = null;
    if (lastChunkAt) {
      const parsed = Date.parse(lastChunkAt);
      if (Number.isFinite(parsed)) lastEpoch = Math.floor(parsed / 1000);
    }
    return {
      ...feed,
      has_audio: lastChunkAt != null,
      last_heard_at: lastChunkAt,
      last_filename: null,
      live: lastEpoch != null && chunkIsLive(lastEpoch, now),
    };
  });
}

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
    const response = await fetchImpl(`${base}/api/snapshot`, {
      signal,
      headers: { Accept: 'application/json' },
    });
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
