/**
 * County event log: what changed across the county feeds, when, and which
 * changes are possibly related. Rules only (no language model).
 *
 *   GET /api/local/events[?since=<epoch ms>]   (index.js mounts it)
 *
 * A sweep every 2 minutes reads the county envelopes plus a few keyless
 * national feeds (eventSources.js), compares each item with the last sweep,
 * and records "new", "update" and "cleared" events. Events are immutable
 * once emitted except that `related` may grow. A source that fails is
 * marked ok:false and its items are left alone: a failure never turns into
 * a burst of "cleared" events.
 *
 * Correlation is conservative and explainable. Two events are linked as
 * "possibly related" (never as cause) when
 *   (a) both have positions within 1.0 mi and happened within 3 h
 *       (calls, traffic, reports, flooding, outages, aircraft);
 *   (b) a traffic event and a call or report name the same numbered road
 *       within 3 h (and, when both have positions, within 3 mi: Route 9 and
 *       the Parkway run the length of the county);
 *   (c) a Coast Guard aircraft was within 3 nm and 2 h of a call or report
 *       that reads like a water emergency (anywhere on its recent track).
 * NWS alerts and storms are never linked by distance. At most 6 links per
 * event, strongest rule first. A new event joins the earliest thread it
 * links to; earlier events keep their threadId (they are immutable), and
 * the new event's `related` names them.
 *
 * Kept in memory (48 h, at most 600 events) and in
 * .gev-data/event-log.json (mode 0600, written atomically). The route reads
 * memory only; it never triggers a fetch. A sweep never throws or hangs:
 * each stage is isolated and each kind of problem is logged once
 * (warnOnce), not every 2 minutes.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  aircraftObservations,
  alertObservations,
  alertTone,
  altimeterStations,
  callObservations,
  capeMayOutages,
  durationText,
  easternTime,
  faaObservations,
  fetchFaa,
  fetchMilitary,
  fetchStorms,
  floodObservations,
  fmtInt,
  milesBetween,
  milesText,
  nmBetween,
  outageBand,
  outageObservations,
  overTownText,
  reportObservations,
  sentence,
  shortHash,
  stormClassName,
  stormObservations,
  trafficObservations,
  vipWhere,
} from './eventSources.js';

const HOUR = 3600_000;
export const EVENT_KEEP_MS = 48 * HOUR;
export const EVENT_MAX = 600;
export const RESPONSE_MAX = 200;
export const RELATED_CAP = 6;
export const SWEEP_MS = 2 * 60_000;
export const STORM_EVERY_MS = 15 * 60_000;
const FIRST_SWEEP_MS = 10_000;
/** A point item older than this on first sight is history, not news. */
const FIRST_SIGHT_MAX_MS = 6 * HOUR;
/** A cleared item seen again within this window continues its thread. */
const REENTRY_MS = 6 * HOUR;
/** Unseen this long (source down): forget quietly; we cannot say when it ended. */
const UNSEEN_FORGET_MS = 6 * HOUR;
const ACTIVE_FORGET_MS = 24 * HOUR;
const TRACK_KEEP_MS = 2 * HOUR;
const OPEN_WINDOW_MS = 2 * HOUR;
const MILITARY_COOLDOWN_MS = 4 * 60_000;
const MILITARY_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

const NEAR_MILES = 1.0;
const NEAR_MS = 3 * HOUR;
const ROAD_MS = 3 * HOUR;
const ROAD_MILES = 3;
const CG_NM = 3;
const CG_MS = 2 * HOUR;
const CG_REASON = 'Coast Guard aircraft nearby';
const DISTANCE_KINDS = new Set([
  'call',
  'traffic',
  'report',
  'flooding',
  'outage',
  'aircraft',
]);
const PEOPLE_KINDS = new Set(['call', 'report']);

export const EVENT_KINDS = Object.freeze([
  'call',
  'traffic',
  'report',
  'flooding',
  'alert',
  'aircraft',
  'storm',
  'outage',
  'airport',
]);

/** Each source the log follows, in display order. */
const SOURCES = Object.freeze([
  {
    id: 'calls',
    name: 'Fire Wire scanner calls',
    short: 'scanner calls',
    envelope: 'calls',
    adapter: callObservations,
    misses: 2,
    // A call that ages out of Fire Wire's 48 h list did not "clear".
    silentClear: (item, now) =>
      now - (item.firstAt ?? item.firstSeen) > 6 * HOUR,
  },
  {
    id: 'traffic',
    name: 'TomTom traffic incidents',
    short: 'traffic incidents',
    envelope: 'traffic',
    adapter: trafficObservations,
    misses: 2,
  },
  {
    id: 'reports',
    name: 'Community reports (reviewed)',
    short: 'community reports',
    envelope: 'reports',
    adapter: reportObservations,
    misses: 1,
  },
  {
    id: 'flooding',
    name: 'NOAA tide and flood gauges',
    envelope: 'gauges',
    adapter: floodObservations,
    misses: 1,
    partial: (env) => /NWPS gauges unavailable/i.test(String(env?.note || '')),
  },
  {
    id: 'alerts',
    name: 'National Weather Service alerts',
    envelope: 'alerts',
    adapter: alertObservations,
    misses: 2,
  },
  {
    id: 'outages',
    name: 'Atlantic City Electric outages',
    envelope: 'outages',
    adapter: outageObservations,
    misses: 2,
  },
  {
    id: 'aircraft',
    name: 'adsb.lol military aircraft (ADS-B)',
    feed: 'military',
    adapter: (data, now, ctx) =>
      aircraftObservations(data.aircraft, { stations: ctx?.stations || [] }),
    // Low helicopters drop in and out of ADS-B coverage over the water:
    // three answered sweeps (about 6 minutes) before "no longer reported".
    misses: 3,
  },
  {
    id: 'storms',
    name: 'National Hurricane Center',
    feed: 'storms',
    adapter: (data, now) => stormObservations(data.storms, now),
    misses: 1,
  },
  {
    id: 'airport',
    name: 'FAA NAS Status',
    feed: 'faa',
    adapter: (data) => faaObservations(data),
    misses: 2,
  },
]);

const INCIDENT_SOURCES = ['calls', 'traffic', 'reports'];

export function createEventLog() {
  return {
    version: 1,
    events: [],
    items: {},
    sources: {},
    summary: null,
    fetch: { stormsAt: 0, militaryCooldownUntil: 0 },
    latest: { outages: null },
  };
}

// ------------------------------------------------------------------ helpers

/** A repeating problem is logged again only after this long. */
const WARN_REPEAT_MS = 6 * HOUR;
const WARN_KEYS_MAX = 200;
const warned = new Map(); // "stage|message with digits masked" -> last logged at

/**
 * Log a problem once per stage and kind of error, not every sweep. Digits are
 * masked when comparing ("HTTP 429" and "HTTP 503" are one kind), the full
 * message is printed. Returns whether it was logged.
 */
export function warnOnce(stage, error, now = Date.now(), log = console.warn) {
  const message =
    String(error?.message ?? error ?? 'unknown error')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300) || 'unknown error';
  const key = `${stage}|${message.replace(/\d+/g, '#')}`;
  const last = warned.get(key);
  if (last !== undefined && now - last >= 0 && now - last < WARN_REPEAT_MS)
    return false;
  warned.delete(key);
  warned.set(key, now);
  if (warned.size > WARN_KEYS_MAX) warned.delete(warned.keys().next().value);
  try {
    log(`[EventLog:${stage}]`, message);
  } catch {
    /* a logger that throws must not stop the sweep */
  }
  return true;
}

/** Forget what was logged (tests). */
export function resetEventLogWarnings() {
  warned.clear();
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const hasPoint = (x) => finite(x?.lat) && finite(x?.lon);

const joinAnd = (list) =>
  list.length <= 1
    ? list.join('')
    : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

function addRelated(from, to, reason) {
  if (from.related.some((r) => r.id === to.id)) return true;
  if (from.related.length >= RELATED_CAP) return false;
  from.related.push({ id: to.id, reason });
  return true;
}

/** An aircraft item remembers every incident it was linked to, by any rule. */
function noteAircraftLink(ctx, air, other) {
  if (air.kind !== 'aircraft' || other.kind === 'aircraft') return;
  const item = ctx.log.items[air.key];
  if (!item) return;
  item.linked ??= [];
  if (!item.linked.includes(other.id))
    item.linked = [...item.linked, other.id].slice(-200);
}

function link(ctx, a, b, reason) {
  const added = addRelated(a, b, reason);
  addRelated(b, a, reason);
  noteAircraftLink(ctx, a, b);
  noteAircraftLink(ctx, b, a);
  return added;
}

/** How two events are possibly related, or null. Lower priority wins. */
function relation(ctx, a, b) {
  // (c) Coast Guard aircraft near a water emergency: anywhere on its track
  // in the last 2 hours, not only where it was first seen.
  const air = a._cg ? a : b._cg ? b : null;
  const person = air === a ? b : a;
  if (
    air &&
    PEOPLE_KINDS.has(person.kind) &&
    person._water &&
    hasPoint(person)
  ) {
    const item = ctx.log.items[air.key];
    if (!item?.linked?.includes(person.id)) {
      const points = [
        { lat: air.lat, lon: air.lon, t: air.at },
        ...(item?.track || []),
      ];
      const near = points.some(
        (p) =>
          hasPoint(p) &&
          finite(p.t) &&
          Math.abs(p.t - person.at) <= CG_MS &&
          nmBetween(p, person) <= CG_NM,
      );
      if (near) return { priority: 0, distance: 0, reason: CG_REASON };
    }
  }
  const dt = Math.abs(a.at - b.at);
  const miles = hasPoint(a) && hasPoint(b) ? milesBetween(a, b) : null;
  // (b) The same numbered road, a traffic event and a call or report.
  const traffic = a.kind === 'traffic' ? a : b.kind === 'traffic' ? b : null;
  const other = traffic === a ? b : a;
  if (traffic && PEOPLE_KINDS.has(other.kind) && dt <= ROAD_MS) {
    const road = (traffic._roads || []).find((r) =>
      (other._roads || []).includes(r),
    );
    if (road && (miles === null || miles <= ROAD_MILES))
      return {
        priority: 1,
        distance: miles ?? 99,
        reason: `same road: ${road}`,
      };
  }
  // (a) Close in place and time.
  if (
    DISTANCE_KINDS.has(a.kind) &&
    DISTANCE_KINDS.has(b.kind) &&
    miles !== null &&
    miles <= NEAR_MILES &&
    dt <= NEAR_MS
  )
    return {
      priority: 2,
      distance: miles,
      reason: `${milesText(miles)} and ${durationText(dt)} apart`,
    };
  return null;
}

/** Is `other` already linked to some event of the item `key`? */
const linkedToItem = (ctx, other, key) =>
  other.related.some((r) => ctx.index.get(r.id)?.key === key);

/** Link a fresh event to earlier ones; a "new" event joins the earliest thread. */
function correlate(ctx, ev) {
  if (ev.change === 'cleared' || ev.kind === 'alert' || ev.kind === 'storm')
    return [];
  const best = new Map(); // other key -> candidate (latest event of that item)
  for (const other of ctx.log.events) {
    if (
      other.id === ev.id ||
      other.key === ev.key ||
      other.change === 'cleared' ||
      other.kind === 'alert' ||
      other.kind === 'storm'
    )
      continue;
    // An update does not link again to an item its thread already names.
    if (ev.change === 'update' && linkedToItem(ctx, other, ev.key)) continue;
    const rel = relation(ctx, ev, other);
    if (!rel) continue;
    const prev = best.get(other.key);
    if (!prev || other.seenAt > prev.other.seenAt)
      best.set(other.key, { other, ...rel });
  }
  const picked = [...best.values()].sort(
    (x, y) => x.priority - y.priority || x.distance - y.distance,
  );
  const linked = [];
  for (const c of picked)
    if (link(ctx, ev, c.other, c.reason)) linked.push(c.other);
  return linked;
}

function rootTime(ctx, threadId, fallback) {
  const root = ctx.index.get(threadId);
  return root ? (root.at ?? root.seenAt) : fallback;
}

function emit(ctx, item, change, text, obs) {
  const { log, index, now } = ctx;
  item.seq = (item.seq || 0) + 1;
  let id = `ev-${shortHash(item.key)}-${now.toString(36)}`;
  if (index.has(id)) id = `${id}-${item.seq}`;
  const ev = {
    id,
    key: item.key,
    kind: item.kind,
    change,
    title: String(text.title || ''),
    place: String(text.place ?? item.place ?? ''),
    detail: String(text.detail || ''),
    // The source's time, but never later than now (a planned start or a
    // skewed clock would otherwise sort ahead of everything that happened).
    at: change === 'new' && finite(obs?.at) ? Math.min(obs.at, now) : now,
    seenAt: now,
    lat: hasPoint(obs) ? obs.lat : hasPoint(item) ? item.lat : null,
    lon: hasPoint(obs) ? obs.lon : hasPoint(item) ? item.lon : null,
    layer: item.layer || null,
    severity: change === 'cleared' ? 'info' : obs?.severity || 'info',
    source: item.sourceName,
    threadId: item.threadId || id,
    related: [],
    _roads: obs?.meta?.roads || [],
    _water: !!obs?.meta?.water,
    _cg: !!obs?.meta?.coastGuard,
  };
  const prev = item.lastEventId ? index.get(item.lastEventId) : null;
  if (prev && change !== 'new')
    link(ctx, ev, prev, change === 'cleared' ? 'cleared' : 'update');
  const linked = correlate(ctx, ev);
  if (change === 'new' && linked.length) {
    // Emitted events cannot move, so the new one joins the earliest
    // existing thread it links to: that is how two threads merge.
    let thread = ev.threadId;
    let earliest = Infinity;
    for (const other of linked) {
      const t = rootTime(ctx, other.threadId, other.at);
      if (t < earliest || (t === earliest && other.threadId < thread)) {
        earliest = t;
        thread = other.threadId;
      }
    }
    ev.threadId = thread;
  }
  if (change === 'new') item.threadId = ev.threadId;
  item.firstEventId ??= ev.id;
  item.lastEventId = ev.id;
  log.events.push(ev);
  index.set(ev.id, ev);
  ctx.fresh.push(ev);
  return ev;
}

function remember(item, obs, now) {
  item.lastSeen = now;
  item.misses = 0;
  item.text = obs.text;
  item.severity = obs.severity;
  item.place = obs.text.place || item.place || '';
  if (hasPoint(obs)) {
    item.lat = obs.lat;
    item.lon = obs.lon;
  }
  if (obs.nowText) item.nowText = obs.nowText;
  if (obs.track && hasPoint(obs)) {
    item.track = [
      ...(item.track || []).filter((p) => now - p.t <= TRACK_KEEP_MS),
      { lat: obs.lat, lon: obs.lon, t: now },
    ].slice(-90);
  }
}

function observe(ctx, spec, obs) {
  const { log, now } = ctx;
  let item = log.items[obs.key];
  if (item?.status === 'cleared' && now - item.clearedAt > REENTRY_MS) {
    delete log.items[obs.key];
    item = null;
  }
  if (!item) {
    if (
      obs.firstSightLimit &&
      finite(obs.at) &&
      now - obs.at > FIRST_SIGHT_MAX_MS
    ) {
      log.items[obs.key] = {
        key: obs.key,
        kind: obs.kind,
        source: spec.id,
        status: 'quiet',
        firstSeen: now,
        lastSeen: now,
      };
      return;
    }
    item = {
      key: obs.key,
      kind: obs.kind,
      source: spec.id,
      sourceName: obs.source,
      layer: obs.layer,
      status: 'active',
      seq: 0,
      threadId: null,
      firstEventId: null,
      lastEventId: null,
      firstSeen: now,
      firstAt: finite(obs.at) ? obs.at : now,
      snap: obs.snap,
      misses: 0,
      clearedAt: null,
      cg: !!obs.meta?.coastGuard,
      track: [],
      linked: [],
    };
    log.items[obs.key] = item;
    remember(item, obs, now);
    emit(ctx, item, 'new', obs.text, obs);
    return;
  }
  if (item.status === 'quiet') {
    item.lastSeen = now;
    return;
  }
  remember(item, obs, now);
  if (item.status === 'cleared') {
    item.status = 'active';
    item.clearedAt = null;
    item.snap = obs.snap;
    const text = obs.again?.() || {
      ...obs.text,
      title: `Again: ${obs.text.title}`,
    };
    emit(ctx, item, 'update', text, obs);
    return;
  }
  const change = obs.update?.(item.snap || {}, item) || null;
  item.snap = obs.snap;
  if (change) emit(ctx, item, 'update', change, obs);
}

function clearedText(item, c, now) {
  const s = item.snap || {};
  const lasted = durationText(now - (item.firstAt ?? item.firstSeen));
  const lastSeenAt = easternTime(item.lastSeen, now);
  switch (item.kind) {
    case 'call':
      return {
        title: 'Call cleared from the scanner list',
        detail: `${sentence(s.type || 'Call')} · no longer listed by Fire Wire`,
      };
    case 'traffic': {
      const road = s.road || '';
      if (/^road closed$/i.test(s.type || ''))
        return {
          title: road ? `${road} reopened` : 'Road closure cleared',
          detail: `Closed about ${lasted} · no longer listed by TomTom`,
        };
      return {
        title: `${s.type || 'Traffic incident'}${road ? ` on ${road}` : ''} cleared`,
        detail: `Listed about ${lasted} · no longer listed by TomTom`,
      };
    }
    case 'report':
      return {
        title: 'Community report no longer shown',
        detail: `${s.title || 'Report'} · removed or closed by a moderator`,
      };
    case 'flooding':
      return {
        title: 'Back below minor flood stage',
        place: s.place,
        detail: c?.reading ? `Latest reading ${c.reading}` : '',
      };
    case 'alert':
      return {
        title: `${s.event || 'NWS alert'} ended`,
        detail: 'No longer active in NWS alerts (expired or cancelled)',
      };
    case 'outage':
      return {
        title: 'Power outages in Cape May County under 100 customers',
        place: 'Cape May County',
        detail: c ? `${fmtInt(c.out)} customers out now` : '',
      };
    case 'airport':
      return {
        title: `${s.title || 'FAA program'} ended`,
        place: s.place,
        detail: `No longer listed by FAA NAS Status · lasted about ${lasted}`,
      };
    case 'storm':
      return {
        title:
          `NHC no longer lists ${stormClassName(s.cls)} ${s.name || ''}`.trim(),
        detail: 'No longer in the National Hurricane Center active storm list',
      };
    case 'aircraft': {
      const label = s.label || 'Aircraft';
      if (s.vip) {
        if (c?.outside)
          return {
            title: `${label} left the Cape May area`,
            detail:
              `More than 150 nm from Cape May · last reported ${s.where || ''} at ${lastSeenAt}`.replace(
                /\s+/g,
                ' ',
              ),
          };
        if (c?.ground) {
          const where = hasPoint(c.point) ? vipWhere(c.point, 0) : null;
          return {
            title: where?.near
              ? `${label} on the ground ${where.text}`
              : `${label} reported on the ground`,
            place: where?.near ? where.place : '',
            detail:
              `Last airborne report ${s.where || ''} at ${lastSeenAt}`.replace(
                /\s+/g,
                ' ',
              ),
          };
        }
        return {
          title: `${label} no longer reported`,
          detail: `Last reported ${s.where || ''} at ${lastSeenAt}`.replace(
            /\s+/g,
            ' ',
          ),
        };
      }
      if (c?.ground && hasPoint(c.point) && !c.outside)
        return {
          title: `${label} on the ground ${overTownText(c.point).text.replace(/^over /, 'in ')}`,
          detail:
            `Last airborne report ${s.where || ''} at ${lastSeenAt}`.replace(
              /\s+/g,
              ' ',
            ),
        };
      return {
        title: `${label} no longer over Cape May County`,
        detail: `Last reported ${s.where || ''} at ${lastSeenAt}`.replace(
          /\s+/g,
          ' ',
        ),
      };
    }
    default:
      return { title: 'No longer listed', detail: '' };
  }
}

function clearItem(ctx, spec, item, c) {
  const { log, now } = ctx;
  if (now - item.lastSeen > UNSEEN_FORGET_MS || spec.silentClear?.(item, now)) {
    delete log.items[item.key];
    return;
  }
  emit(ctx, item, 'cleared', clearedText(item, c, now), null);
  item.status = 'cleared';
  item.clearedAt = now;
  item.misses = 0;
}

function readSource(spec, snapshot, prev) {
  if (spec.envelope) {
    const env = snapshot.envelopes?.[spec.envelope];
    if (!env || typeof env !== 'object')
      return { ok: false, at: prev?.at ?? null };
    const ok = env.status === 'live' || env.status === 'delayed';
    const fetchedAt = finite(env.fetchedAt) ? env.fetchedAt : null;
    return {
      ok,
      at: fetchedAt,
      fetchedAt,
      data: env,
      // The same cached answer as last sweep holds nothing new.
      unchanged: ok && fetchedAt !== null && fetchedAt === prev?.fetchedAt,
      partial: !!spec.partial?.(env),
    };
  }
  const data = snapshot[spec.feed];
  if (data === undefined) return { skip: true };
  return {
    ok: !!data?.ok,
    at: finite(data?.at) ? data.at : null,
    fetchedAt: finite(data?.at) ? data.at : null,
    data,
    unchanged: false,
    partial: false,
  };
}

/** Coast Guard aircraft closing on a water emergency: an update carrying the link. */
function approachUpdates(ctx) {
  const { log, now } = ctx;
  for (const item of Object.values(log.items)) {
    if (item.kind !== 'aircraft' || !item.cg || item.status !== 'active')
      continue;
    if (!hasPoint(item)) continue;
    item.linked ??= [];
    // Incidents (by item) this aircraft is already linked to, by any event.
    const done = new Set(item.linked.map((id) => ctx.index.get(id)?.key));
    for (const ev of log.events) {
      if (
        !PEOPLE_KINDS.has(ev.kind) ||
        ev.change === 'cleared' ||
        !ev._water ||
        !hasPoint(ev) ||
        Math.abs(now - ev.at) > CG_MS ||
        item.linked.includes(ev.id) ||
        done.has(ev.key) ||
        nmBetween(item, ev) > CG_NM
      )
        continue;
      const what = String(
        log.items[ev.key]?.text?.title || ev.title || 'water',
      ).toLowerCase();
      emit(
        ctx,
        item,
        'update',
        {
          title: item.nowText || item.text?.title || 'Coast Guard aircraft',
          place: item.place,
          detail:
            ev.kind === 'report'
              ? `Within ${CG_NM} nm of a resident report from ${easternTime(ev.at, now)}`
              : `Within ${CG_NM} nm of the ${what} call at ${easternTime(ev.at, now)}`,
        },
        {
          lat: item.lat,
          lon: item.lon,
          severity: 'info',
          meta: { coastGuard: true },
        },
      );
      // At most one approach update per aircraft and incident, linked or not.
      noteAircraftLink(ctx, { kind: 'aircraft', key: item.key }, ev);
      break;
    }
  }
}

function prune(log, now) {
  const cutoff = now - EVENT_KEEP_MS;
  let events = log.events.filter((e) => e.seenAt >= cutoff);
  if (events.length > EVENT_MAX) {
    events = [...events].sort((a, b) => a.seenAt - b.seenAt).slice(-EVENT_MAX);
  }
  log.events = events;
  for (const [key, item] of Object.entries(log.items)) {
    if (item.status === 'cleared' && now - item.clearedAt > REENTRY_MS)
      delete log.items[key];
    else if (
      item.status === 'quiet' &&
      now - item.lastSeen > FIRST_SIGHT_MAX_MS
    )
      delete log.items[key];
    else if (item.status === 'active' && now - item.lastSeen > ACTIVE_FORGET_MS)
      delete log.items[key];
    else if (item.track?.length)
      item.track = item.track.filter((p) => now - p.t <= TRACK_KEEP_MS);
  }
}

/**
 * One comparison pass. `snapshot` = { envelopes: {calls, traffic, reports,
 * gauges, alerts, outages, weather?}, military?, storms?, faa? } — a feed
 * left undefined was not fetched this sweep and is skipped; `weather` (the
 * airport-weather METARs) only supplies altimeter settings. Returns the
 * events emitted by this pass, in order.
 */
export function ingest(log, snapshot = {}, now = Date.now()) {
  const ctx = {
    log,
    now,
    fresh: [],
    index: new Map(log.events.map((e) => [e.id, e])),
    stations: [],
  };
  try {
    // Local altimeter settings, to read low aircraft altitudes (not a source of events).
    ctx.stations = altimeterStations(snapshot.envelopes?.weather, now);
  } catch (error) {
    warnOnce('altimeter', error, now);
  }
  for (const spec of SOURCES) {
    try {
      ingestSource(ctx, spec, snapshot);
    } catch (error) {
      // A bug in one source costs that source this sweep, nothing more. It
      // never reaches the "gone" pass, so nothing is cleared because of it.
      warnOnce(`source:${spec.id}`, error, now);
      if (log.sources[spec.id]) log.sources[spec.id].ok = false;
    }
  }
  try {
    approachUpdates(ctx);
  } catch (error) {
    warnOnce('approach', error, now);
  }
  try {
    prune(log, now);
  } catch (error) {
    warnOnce('prune', error, now);
  }
  try {
    log.summary = summarize(log, now);
  } catch (error) {
    // Keep the last good summary rather than none.
    warnOnce('summary', error, now);
  }
  return ctx.fresh;
}

function ingestSource(ctx, spec, snapshot) {
  const { log, now } = ctx;
  const prev = log.sources[spec.id];
  const answer = readSource(spec, snapshot, prev);
  if (answer.skip) return;
  log.sources[spec.id] = {
    ok: answer.ok,
    at: answer.at ?? prev?.at ?? null,
    fetchedAt: answer.ok ? answer.fetchedAt : (prev?.fetchedAt ?? null),
  };
  if (!answer.ok || answer.unchanged) return;
  const result = spec.adapter(answer.data, now, ctx) || { active: [] };
  if (spec.id === 'outages') log.latest.outages = capeMayOutages(answer.data);
  const seen = new Set();
  for (const obs of result.active || []) {
    if (!obs?.key || seen.has(obs.key)) continue;
    // Seen even if it fails below: a bad record is never "gone".
    seen.add(obs.key);
    try {
      observe(ctx, spec, obs);
    } catch (error) {
      warnOnce(`observe:${spec.id}`, error, now);
    }
  }
  if (answer.partial || result.partial) return;
  for (const item of Object.values(log.items)) {
    if (item.source !== spec.id || seen.has(item.key)) continue;
    if (result.hold?.has(item.key)) continue;
    if (item.status === 'quiet') {
      if (!result.gone) delete log.items[item.key];
      continue;
    }
    if (item.status !== 'active') continue;
    if (result.gone && !result.gone.has(item.key)) continue;
    item.misses = (item.misses || 0) + 1;
    if (item.misses < spec.misses) continue;
    clearItem(
      ctx,
      spec,
      item,
      result.gone?.get(item.key) ?? result.ctx?.get(item.key) ?? null,
    );
  }
}

// ------------------------------------------------------------------ summary

const TONE_RANK = { danger: 3, warn: 2, watch: 1, ok: 0 };
const SEVERITY_TONE = {
  info: 'ok',
  watch: 'watch',
  warn: 'warn',
  danger: 'danger',
};
const FLOOD_RANK = { minor: 1, moderate: 2, major: 3 };
const FLOOD_TONE = { minor: 'watch', moderate: 'warn', major: 'danger' };
const OUTAGE_TONE = ['ok', 'watch', 'watch', 'warn', 'danger'];

function incidentPhrase(item) {
  const title = String(item.text?.title || '').toLowerCase();
  const place = item.place || '';
  if (item.kind === 'traffic') return `${title}${place ? ` on ${place}` : ''}`;
  if (item.kind === 'report')
    return `resident report${place ? ` in ${place}` : ''}`;
  return `${title}${place ? ` in ${place}` : ''}`;
}

/** "Right now": rules only, worst first, each line with its source. */
export function summarize(log, now = Date.now()) {
  const lines = [];
  const active = Object.values(log.items).filter((i) => i.status === 'active');
  const of = (kind) => active.filter((i) => i.kind === kind);
  const ok = (id) => !!log.sources[id]?.ok;
  const push = (group, line) => lines.push({ group, ...line });

  const alerts = of('alert').sort(
    (a, b) =>
      TONE_RANK[alertTone(b.snap?.event, b.snap?.severity)] -
      TONE_RANK[alertTone(a.snap?.event, a.snap?.severity)],
  );
  for (const a of alerts.slice(0, 4))
    push(0, {
      text: a.snap?.expires
        ? `${a.snap.event} until ${easternTime(a.snap.expires, now)}`
        : `${a.snap?.event || 'NWS alert'} in effect`,
      tone: alertTone(a.snap?.event, a.snap?.severity),
      source: 'NWS',
      eventId: a.lastEventId || null,
    });
  if (alerts.length > 4)
    push(0, {
      text: `${alerts.length - 4} more NWS alerts in effect`,
      tone: 'watch',
      source: 'NWS',
      eventId: null,
    });

  const open = active
    .filter(
      (i) =>
        INCIDENT_SOURCES.includes(i.source) &&
        now - (i.firstAt ?? i.firstSeen) <= OPEN_WINDOW_MS,
    )
    .sort((a, b) => (b.firstAt ?? 0) - (a.firstAt ?? 0));
  if (open.length) {
    const named = open.slice(0, 3).map(incidentPhrase);
    push(1, {
      text: `${open.length} open: ${named.join(', ')}${open.length > 3 ? `, and ${open.length - 3} more` : ''}`,
      tone: open.some((i) => i.severity === 'warn' || i.severity === 'danger')
        ? 'warn'
        : 'watch',
      source: [...new Set(open.map((i) => i.sourceName))].join(' · '),
      eventId: open[0].lastEventId || null,
    });
  }

  const floods = of('flooding').sort(
    (a, b) => (FLOOD_RANK[b.snap?.cat] || 0) - (FLOOD_RANK[a.snap?.cat] || 0),
  );
  for (const f of floods.slice(0, 3)) {
    const cat = String(f.snap?.cat || 'minor');
    const Cat = cat[0].toUpperCase() + cat.slice(1);
    push(2, {
      text: f.snap?.observed
        ? `${Cat} flooding observed at ${f.snap.place}`
        : `${Cat} flooding forecast at ${f.snap?.place}${finite(f.snap?.forecastAt) ? ` for ${easternTime(f.snap.forecastAt, now)}` : ''}`,
      tone: FLOOD_TONE[cat] || 'watch',
      source: 'NOAA water gauges',
      eventId: f.lastEventId || null,
    });
  }
  if (floods.length > 3)
    push(2, {
      text: `${floods.length - 3} more gauges at or above minor flood stage`,
      tone: 'watch',
      source: 'NOAA water gauges',
      eventId: null,
    });

  const outages = ok('outages') ? log.latest?.outages : null;
  if (outages && outages.out > 0) {
    const item = log.items['outage:ace:cape-may'];
    push(3, {
      text: `Power out for ${fmtInt(outages.out)} customer${outages.out === 1 ? '' : 's'} in Cape May County`,
      tone: OUTAGE_TONE[outageBand(outages.out)],
      source: 'Atlantic City Electric',
      eventId: item?.status === 'active' ? item.lastEventId : null,
    });
  }

  for (const a of of('airport'))
    push(4, {
      text: a.text?.title || a.snap?.title || 'FAA airport program',
      tone: /ground stop/i.test(a.snap?.title || '') ? 'warn' : 'watch',
      source: 'FAA',
      eventId: a.lastEventId || null,
    });

  for (const s of of('storm').filter(
    (s) => (s.snap?.miles ?? Infinity) <= 1000,
  ))
    push(5, {
      text: `${s.text?.title} · ${s.place}`,
      tone: SEVERITY_TONE[s.severity] || 'watch',
      source: 'NHC',
      eventId: s.lastEventId || null,
    });

  for (const a of of('aircraft').slice(0, 3))
    push(6, {
      text: a.nowText || a.text?.title || 'Notable aircraft airborne',
      tone: 'ok',
      source: 'adsb.lol',
      eventId: a.lastEventId || null,
    });

  const down = INCIDENT_SOURCES.filter((id) => !ok(id)).map(
    (id) => SOURCES.find((s) => s.id === id).short,
  );
  const hazard = lines.some((l) => l.tone !== 'ok');
  if (!hazard && !alerts.length && !open.length) {
    if (ok('alerts') && !down.length) {
      push(-1, {
        text: 'Quiet: no NWS alerts, no open incidents in the last 2 hours.',
        tone: 'ok',
        source: 'NWS · Fire Wire scanner · TomTom traffic · Community reports',
        eventId: null,
      });
    } else {
      const parts = [
        ok('alerts')
          ? 'No NWS alerts.'
          : 'NWS alerts are not answering right now.',
        down.length === INCIDENT_SOURCES.length
          ? 'Open incidents cannot be checked: scanner calls, traffic incidents and community reports are not answering.'
          : down.length
            ? `No open incidents in the last 2 hours from the feeds answering; ${joinAnd(down)} ${down.length === 1 ? 'is' : 'are'} not answering.`
            : 'No open incidents in the last 2 hours.',
      ];
      push(-1, {
        text: parts.join(' '),
        tone: ok('alerts') ? 'ok' : 'watch',
        source: 'Cape May Dispatch',
        eventId: null,
      });
    }
  } else {
    if (!ok('alerts'))
      push(7, {
        text: 'NWS alerts are not answering right now.',
        tone: 'watch',
        source: 'NWS',
        eventId: null,
      });
    if (down.length)
      push(8, {
        text: `${joinAnd(down).replace(/^\w/, (c) => c.toUpperCase())} ${down.length === 1 ? 'is' : 'are'} not answering, so open incidents may be missing.`,
        tone: 'ok',
        source: 'Cape May Dispatch',
        eventId: null,
      });
  }
  lines.sort(
    (a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone] || a.group - b.group,
  );
  return {
    at: now,
    lines: lines.slice(0, 10).map(({ text, tone, source, eventId }) => ({
      text,
      tone,
      source,
      eventId,
    })),
  };
}

// ------------------------------------------------------------------ response

const publicEvent = (e) => ({
  id: e.id,
  key: e.key,
  kind: e.kind,
  change: e.change,
  title: e.title,
  place: e.place,
  detail: e.detail,
  at: e.at,
  seenAt: e.seenAt,
  lat: finite(e.lat) ? e.lat : null,
  lon: finite(e.lon) ? e.lon : null,
  layer: e.layer ?? null,
  severity: e.severity,
  source: e.source,
  threadId: e.threadId,
  related: (e.related || []).map((r) => ({ id: r.id, reason: r.reason })),
});

export function eventLogResponse(
  log,
  { since = null, now = Date.now(), disabled = false } = {},
) {
  const cutoff = now - EVENT_KEEP_MS;
  const events = log.events
    .filter((e) => e.seenAt >= cutoff && (since === null || e.seenAt > since))
    .sort((a, b) => b.at - a.at || b.seenAt - a.seenAt)
    .slice(0, RESPONSE_MAX)
    .map(publicEvent);
  // Turned off: a summary saved before then is not "right now".
  const summary = (!disabled && log.summary) || {
    at: now,
    lines: [
      {
        text: disabled
          ? 'The county event log is turned off on this server.'
          : 'Starting up: the first county sweep runs shortly after the server starts.',
        tone: 'ok',
        source: 'Cape May Dispatch',
        eventId: null,
      },
    ],
  };
  return {
    generatedAt: now,
    summary,
    sources: SOURCES.map((s) => ({
      id: s.id,
      name: s.name,
      ok: !!log.sources[s.id]?.ok,
      at: log.sources[s.id]?.at ?? null,
    })),
    events,
  };
}

/** GET /api/local/events → [status, body]. `since` must be epoch ms. */
export function eventsRoute(
  searchParams,
  { log, now = Date.now(), env = process.env } = {},
) {
  const raw = searchParams?.get?.('since');
  let since = null;
  if (raw !== null && raw !== undefined && raw !== '') {
    since = Number(raw);
    if (!Number.isFinite(since) || since < 0)
      return [400, { error: 'since must be a time in epoch milliseconds' }];
  }
  return [
    200,
    eventLogResponse(log || sharedEventLog(env), {
      since,
      now,
      disabled: env.GEV_EVENT_LOG === '0',
    }),
  ];
}

// ------------------------------------------------------------------ storage

const dataDir = (env = process.env) =>
  env.GEV_DATA_DIR
    ? path.resolve(env.GEV_DATA_DIR)
    : path.join(process.cwd(), '.gev-data');

export const eventLogFile = (env = process.env) =>
  path.join(dataDir(env), 'event-log.json');

export function saveEventLog(log, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      events: log.events,
      items: log.items,
      sources: log.sources,
      summary: log.summary,
      fetch: log.fetch,
      latest: log.latest,
    }),
    { mode: 0o600 },
  );
  // `mode` applies only when the file is created; a temp file left by a
  // crashed write keeps its old mode, so set it explicitly.
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Read the saved log; a missing or corrupt file starts an empty one. */
export function loadEventLog(file) {
  const log = createEventLog();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return log;
  }
  if (!plainObject(raw) || raw.version !== 1) return log;
  if (Array.isArray(raw.events))
    log.events = raw.events.filter(
      (e) =>
        plainObject(e) &&
        typeof e.id === 'string' &&
        typeof e.key === 'string' &&
        EVENT_KINDS.includes(e.kind) &&
        finite(e.at) &&
        finite(e.seenAt) &&
        Array.isArray(e.related),
    );
  if (plainObject(raw.items))
    for (const [key, item] of Object.entries(raw.items))
      if (
        plainObject(item) &&
        item.key === key &&
        typeof item.status === 'string'
      )
        log.items[key] = {
          ...item,
          linked: Array.isArray(item.linked) ? item.linked : [],
          track: Array.isArray(item.track) ? item.track : [],
        };
  if (plainObject(raw.sources)) log.sources = raw.sources;
  if (plainObject(raw.summary) && Array.isArray(raw.summary.lines))
    log.summary = raw.summary;
  if (plainObject(raw.fetch))
    log.fetch = { ...log.fetch, ...raw.fetch, militaryCooldownUntil: 0 };
  if (plainObject(raw.latest)) log.latest = { ...log.latest, ...raw.latest };
  return log;
}

// ------------------------------------------------------------------ sweep

/** The county envelopes come from local caches; this is a generous ceiling. */
const LOADER_TIMEOUT_MS = 60_000;
/** Each fetcher has its own 12 s deadline; this one catches anything else. */
const FEED_TIMEOUT_MS = 30_000;

/**
 * Resolve with run()'s value, or with fallback(error) when it throws,
 * rejects or takes longer than `ms`. Never rejects, and a late rejection of
 * the abandoned promise is handled (no unhandled rejection).
 */
export function settle(run, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error) => {
      let value;
      try {
        value = fallback(error);
      } catch {
        value = undefined;
      }
      finish(value);
    };
    const limit = ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
    timer = setTimeout(() => fail(new Error(`no answer within ${limit}`)), ms);
    timer.unref?.();
    Promise.resolve().then(run).then(finish, fail);
  });
}

const FEED_LABEL = {
  military: 'adsb.lol /v2/mil',
  storms: 'NHC CurrentStorms.json',
  faa: 'FAA NAS Status',
};

/**
 * One sweep: read every source (gently), compare, save. Never throws and
 * never hangs: a loader or feed that fails or stalls counts as not
 * answering, and each kind of problem is logged once (warnOnce).
 */
export async function runEventSweep({
  log,
  loadEnvelopes,
  fetchImpl = fetch,
  now = Date.now(),
  file = null,
  fetchers = {},
  timeouts = {},
} = {}) {
  const f = (log.fetch ??= { stormsAt: 0, militaryCooldownUntil: 0 });
  const wantStorms = now - (f.stormsAt || 0) >= STORM_EVERY_MS;
  const wantMilitary = now >= (f.militaryCooldownUntil || 0);
  const feedMs = timeouts.feedMs ?? FEED_TIMEOUT_MS;
  const feed = (name, fallbackFetcher) => {
    const run = fetchers[name] || fallbackFetcher;
    return settle(
      () => run({ fetchImpl, now }),
      feedMs,
      (error) => ({
        ok: false,
        at: now,
        error: error?.message || String(error),
      }),
    );
  };
  const [envelopes, military, storms, faa] = await Promise.all([
    settle(
      () => loadEnvelopes?.(),
      timeouts.loaderMs ?? LOADER_TIMEOUT_MS,
      (error) => {
        warnOnce('envelopes', error, now);
        return {};
      },
    ),
    wantMilitary ? feed('fetchMilitary', fetchMilitary) : undefined,
    wantStorms ? feed('fetchStorms', fetchStorms) : undefined,
    feed('fetchFaa', fetchFaa),
  ]);
  if (wantStorms) f.stormsAt = now;
  if (military && !military.ok)
    f.militaryCooldownUntil =
      now +
      (military.status === 429
        ? MILITARY_RATE_LIMIT_COOLDOWN_MS
        : MILITARY_COOLDOWN_MS);
  for (const [name, data] of Object.entries({ military, storms, faa }))
    if (data && !data.ok)
      warnOnce(
        `feed:${name}`,
        `${FEED_LABEL[name]}: ${data.error || 'no answer'}`,
        now,
      );
  let events = [];
  try {
    events = ingest(
      log,
      {
        envelopes: envelopes && typeof envelopes === 'object' ? envelopes : {},
        military,
        storms,
        faa,
      },
      now,
    );
  } catch (error) {
    warnOnce('ingest', error, now);
  }
  if (file) {
    try {
      saveEventLog(log, file);
    } catch (error) {
      warnOnce('save', error, now);
    }
  }
  return events;
}

const SHARED = Symbol.for('gev.eventLog.log');
const SWEEP_STARTED = Symbol.for('gev.eventLog.sweep');

/** The process-wide log (survives a dev-server module reload). */
export function sharedEventLog(env = process.env) {
  globalThis[SHARED] ??= loadEventLog(eventLogFile(env));
  return globalThis[SHARED];
}

/**
 * Start the sweep once per process unless GEV_EVENT_LOG=0. First sweep
 * about 10 s after start, then every 2 minutes; timers are unref'd.
 */
export function installEventLog({
  env = process.env,
  loadEnvelopes,
  fetchImpl = fetch,
} = {}) {
  if (env.GEV_EVENT_LOG === '0' || !loadEnvelopes || globalThis[SWEEP_STARTED])
    return false;
  globalThis[SWEEP_STARTED] = true;
  const file = eventLogFile(env);
  const log = sharedEventLog(env);
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    // runEventSweep never rejects; the catch is a last line, not a path.
    Promise.resolve()
      .then(() => runEventSweep({ log, loadEnvelopes, fetchImpl, file }))
      .catch((error) => warnOnce('sweep', error))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, FIRST_SWEEP_MS).unref?.();
  setInterval(tick, SWEEP_MS).unref?.();
  return true;
}
