/**
 * Live events feed, client side. Reads GET /api/local/events (see
 * server/providers/local) and turns it into the Local panel's "Right now"
 * box and threaded timeline, a news crawl of the newest events, and the
 * county ticker's LATEST item. Everything here is pure except loadEvents,
 * which makes one GET and never throws.
 *
 * Wording rules the markup keeps: every row says its source and its time in
 * US Eastern; a title is shown as the source worded it (the server writes
 * "Fire reported", not "Fire"); events linked by place and time are
 * "possibly related", never a cause. Event text only ever reaches the page
 * escaped, and never in an attribute other than an escaped data-id.
 *
 * English-only county content, like the Local panel.
 */
import { distanceKm, escapeHtml } from './format.js';

const TZ = 'America/New_York';
const EVENTS_URL = '/api/local/events';
/** The server's window and cap (see the events API contract). */
const WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_EVENTS = 200;
/** The ticker's LATEST item shows an event for this long after it happened. */
const LATEST_WINDOW_MS = 60 * 60 * 1000;
/** A source clock a little ahead of ours is still "just now". */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
/** Storms this close to Cape May also switch the rain radar on. */
const CAPE_MAY = Object.freeze({ lat: 38.93, lon: -74.91 });
const RADAR_RADIUS_MI = 300;
const KM_PER_MI = 1.609344;

/**
 * Per kind: the glyph (plain emoji that render on iPhone), a fallback name
 * for an event with no title, and the camera eye height in metres.
 */
// i18n-ignore: the Local panel is English-only county content.
const KINDS = Object.freeze({
  call: { icon: '🚒', name: 'Scanner call', height: 2_500 },
  traffic: { icon: '🚧', name: 'Traffic incident', height: 2_500 },
  report: { icon: '📣', name: 'Community report', height: 2_500 },
  flooding: { icon: '🌊', name: 'Flooding', height: 6_000 },
  outage: { icon: '💡', name: 'Power outage', height: 6_000 },
  alert: { icon: '⚠️', name: 'Weather alert', height: 80_000 },
  aircraft: { icon: '✈️', name: 'Aircraft', height: 60_000 },
  storm: { icon: '🌀', name: 'Tropical system', height: 1_500_000 },
  airport: { icon: '🛫', name: 'Airport status', height: 25_000 },
});
// i18n-ignore: the Local panel is English-only county content.
const OTHER_KIND = Object.freeze({ icon: '📍', name: 'Event', height: 10_000 });

const kindInfo = (kind) =>
  typeof kind === 'string' && Object.hasOwn(KINDS, kind)
    ? KINDS[kind]
    : OTHER_KIND;

const SEVERITIES = new Set(['info', 'watch', 'warn', 'danger']);
const SUMMARY_TONES = new Set(['ok', 'watch', 'warn', 'danger']);
const severityOf = (event) =>
  SEVERITIES.has(event?.severity) ? event.severity : 'info';

// i18n-ignore: the Local panel is English-only county content.
const SAFETY_NOTE = 'Unofficial. In an emergency call 911.';

/* ----------------------------- small helpers ----------------------------- */

const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The latest time a JavaScript Date can hold (ECMA-262 time value range). */
const MAX_DATE_MS = 8.64e15;

/**
 * Epoch ms from a number, a numeric string, an ISO string or a Date; null
 * for anything else. 0, null and '' are missing values, never 1970, and a
 * value no Date can hold (past year 275760) is missing too: Intl would
 * throw on it and blank the whole panel.
 */
function toMs(value) {
  let v = value instanceof Date ? value.getTime() : value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    v = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : Date.parse(s);
  }
  return typeof v === 'number' &&
    Number.isFinite(v) &&
    v > 0 &&
    v <= MAX_DATE_MS &&
    !Number.isNaN(new Date(v).getTime())
    ? v
    : null;
}

const nowMs = (now) => toMs(now) ?? Date.now();

/** Trimmed text, '' for a missing value. */
const text = (value) =>
  value === null || value === undefined ? '' : String(value).trim();

/** When the event happened per its source, else when the server saw it. */
const whenOf = (event) => toMs(event?.at) ?? toMs(event?.seenAt);

const titleOf = (event) => text(event?.title) || kindInfo(event?.kind).name;

/** Newest first by `at`, then by `seenAt`, then by id for a stable order. */
function newestFirst(a, b) {
  return (
    (whenOf(b) ?? 0) - (whenOf(a) ?? 0) ||
    (toMs(b.seenAt) ?? 0) - (toMs(a.seenAt) ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
const oldestFirst = (a, b) => -newestFirst(a, b);

/** related[] from two copies of one event: one entry per other event id. */
function mergeRelated(older, newer) {
  const byId = new Map();
  for (const link of [
    ...(Array.isArray(older) ? older : []),
    ...(Array.isArray(newer) ? newer : []),
  ]) {
    if (isObject(link) && typeof link.id === 'string' && link.id)
      byId.set(link.id, link);
  }
  return [...byId.values()];
}

/** The well-formed events of a data object or an array, one per id. */
function eventsOf(source) {
  const list = Array.isArray(source)
    ? source
    : Array.isArray(source?.events)
      ? source.events
      : [];
  const byId = new Map();
  for (const event of list) {
    if (!isObject(event) || typeof event.id !== 'string' || !event.id) continue;
    const seen = byId.get(event.id);
    byId.set(event.id, {
      ...seen,
      ...event,
      related: mergeRelated(seen?.related, event.related),
    });
  }
  return [...byId.values()];
}

function summaryOf(data) {
  const summary = data?.summary;
  if (!isObject(summary)) return null;
  return {
    ...summary,
    at: toMs(summary.at),
    lines: (Array.isArray(summary.lines) ? summary.lines : []).filter(
      (line) => isObject(line) && text(line.text),
    ),
  };
}

const sourcesOf = (data) =>
  Array.isArray(data?.sources) ? data.sources.filter(isObject) : null;

function normalizeData(body) {
  if (!isObject(body) || !Array.isArray(body.events)) return null;
  return {
    ...body,
    generatedAt: toMs(body.generatedAt),
    summary: summaryOf(body) ?? { at: null, lines: [] },
    sources: sourcesOf(body) ?? [],
    events: eventsOf(body).sort(newestFirst),
  };
}

/* --------------------------------- fetch --------------------------------- */

/**
 * GET /api/local/events (?since=<epoch ms> for only what changed). Never
 * throws: a failure resolves { ok: false, data: null, error }, plus the
 * HTTP `status` when the server answered with an error (a 404 means this
 * server has no events route; see the ticker).
 * @param {{fetchImpl?: Function, signal?: AbortSignal, since?: number}} [options]
 * @returns {Promise<{ok: boolean, data: object|null, error?: string, status?: number}>}
 */
export async function loadEvents({
  fetchImpl = (...a) => globalThis.fetch(...a),
  signal,
  since,
} = {}) {
  const from = toMs(since);
  const url =
    from === null
      ? EVENTS_URL
      : `${EVENTS_URL}?since=${encodeURIComponent(String(Math.floor(from)))}`;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    });
    if (!response?.ok) {
      const status = Number.isInteger(response?.status)
        ? response.status
        : undefined;
      return {
        ok: false,
        data: null,
        error: `Events HTTP ${status ?? 'error'}`,
        ...(status === undefined ? {} : { status }),
      };
    }
    const data = normalizeData(await response.json());
    return data
      ? { ok: true, data }
      : { ok: false, data: null, error: 'Events response was not readable' };
  } catch (failure) {
    return {
      ok: false,
      data: null,
      error:
        failure?.name === 'AbortError'
          ? 'Events request aborted'
          : `Events request failed: ${failure?.message || failure}`,
    };
  }
}

/**
 * Fold an incremental (?since=) response into what the panel already has:
 * events de-duplicated by id (the newer copy wins, related[] is merged),
 * newest first, at most 200, none older than the 48-hour window. Summary
 * and sources come from the newer response.
 * @returns {object|null}
 */
export function mergeEvents(previous, next) {
  const before = isObject(previous) ? previous : null;
  const after = isObject(next) ? next : null;
  if (!before && !after) return null;
  const beforeAt = toMs(before?.generatedAt);
  const afterAt = toMs(after?.generatedAt);
  // A late answer to an older request must not roll the summary back.
  const [older, newer] =
    before &&
    after &&
    beforeAt !== null &&
    afterAt !== null &&
    beforeAt > afterAt
      ? [after, before]
      : [before, after];
  const generatedAt =
    beforeAt === null && afterAt === null
      ? null
      : Math.max(beforeAt ?? 0, afterAt ?? 0);
  const cutoff = generatedAt === null ? null : generatedAt - WINDOW_MS;
  const events = eventsOf([...eventsOf(older), ...eventsOf(newer)])
    .filter(
      (event) =>
        cutoff === null ||
        Math.max(toMs(event.at) ?? 0, toMs(event.seenAt) ?? 0) >= cutoff,
    )
    .sort(newestFirst)
    .slice(0, MAX_EVENTS);
  return {
    ...older,
    ...newer,
    generatedAt,
    summary: summaryOf(newer) ?? summaryOf(older) ?? { at: null, lines: [] },
    sources: sourcesOf(newer) ?? sourcesOf(older) ?? [],
    events,
  };
}

/* --------------------------------- text ---------------------------------- */

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hour: 'numeric',
  minute: '2-digit',
});
const weekdayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  weekday: 'short',
});
const monthDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
});
const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** Safari and newer ICU put a narrow no-break space before AM/PM. */
const plainSpaces = (value) => value.replace(/[\u00a0\u202f]/g, ' ');

/** The Eastern calendar date as a whole day count (DST-proof). */
function easternDay(ms) {
  const parts = Object.fromEntries(
    dateFormat.formatToParts(ms).map(({ type, value }) => [type, value]),
  );
  return (
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
    86_400_000
  );
}

/**
 * "8:42 PM" in US Eastern; "Tue 8:42 PM" on another day within the week;
 * "Nov 12, 8:42 PM" further away; "" for a missing or invalid time.
 */
export function eventTimeText(ms, now = Date.now()) {
  const at = toMs(ms);
  if (at === null) return '';
  const clock = plainSpaces(clockFormat.format(at));
  const daysApart = Math.abs(easternDay(nowMs(now)) - easternDay(at));
  if (daysApart === 0) return clock;
  if (daysApart < 6) return `${weekdayFormat.format(at)} ${clock}`;
  return `${plainSpaces(monthDayFormat.format(at))}, ${clock}`;
}

/** "just now", "12 min ago", "2 h ago", "3 d ago"; "" when invalid. */
export function ageText(ms, now = Date.now()) {
  const at = toMs(ms);
  if (at === null) return '';
  const diff = nowMs(now) - at;
  // i18n-ignore: the Local panel is English-only county content.
  if (diff < 60_000 && diff > -FUTURE_SKEW_MS) return 'just now';
  const minutes = Math.floor(Math.abs(diff) / 60_000);
  const span =
    minutes < 60
      ? `${minutes} min`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} h`
        : `${Math.floor(minutes / 1440)} d`;
  return diff < 0 ? `in ${span}` : `${span} ago`;
}

/** The kind's glyph in an aria-hidden span: the title carries the meaning. */
export function eventIcon(kind) {
  return `<span class="gev-events-icon" aria-hidden="true">${kindInfo(kind).icon}</span>`;
}

/* -------------------------------- crawl ---------------------------------- */

const limitOf = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

/**
 * One crawl item: "8:42 PM · 🚒 Fire reported · Rio Grande · Fire Wire
 * scanner", the source last in a muted span (.gev-events-crawl-source), and
 * a tooltip naming the source and the Eastern time, so an unofficial
 * scanner call never reads like an NWS product.
 */
function crawlItem(event, now, copy) {
  const time = eventTimeText(whenOf(event), now);
  const place = text(event.place);
  const source = text(event.source);
  const parts = [
    time
      ? `<span class="gev-events-crawl-time">${escapeHtml(time)}</span>`
      : '',
    `${eventIcon(event.kind)} <span class="gev-events-crawl-title">${escapeHtml(titleOf(event))}</span>`,
    place
      ? `<span class="gev-events-crawl-place">${escapeHtml(place)}</span>`
      : '',
    // i18n-ignore: the Local panel is English-only county content.
    `<span class="gev-events-crawl-source">${escapeHtml(source || 'source not stated')}</span>`,
  ].filter(Boolean);
  // i18n-ignore: the Local panel is English-only county content.
  const tip = `Source: ${source || 'not stated'}, ${time ? `${time} ET` : 'time not stated'}`;
  return `<button type="button" class="gev-events-crawl-item tone-${severityOf(event)}" data-act="event" data-id="${escapeHtml(event.id)}" title="${escapeHtml(tip)}"${copy ? ' aria-hidden="true" tabindex="-1"' : ''}>${parts.join(' · ')}</button>`;
}

/**
 * A horizontally scrolling crawl of the newest events. The items are
 * rendered twice so CSS can loop the track seamlessly; the second copy is
 * hidden from assistive tech and the tab order. "" when there are none.
 * @param {object[]|{events: object[]}} events
 * @param {{now?: number, limit?: number}} [options]
 */
export function eventCrawlHtml(events, { now = Date.now(), limit = 12 } = {}) {
  const list = eventsOf(events).sort(newestFirst).slice(0, limitOf(limit, 12));
  if (!list.length) return '';
  const at = nowMs(now);
  const copy = (hidden) =>
    list.map((event) => crawlItem(event, at, hidden)).join('');
  return `<div class="gev-events-crawl" role="region" aria-label="Latest events"><div class="gev-events-crawl-track">${copy(false)}${copy(true)}</div></div>`;
}

/* ------------------------------- timeline -------------------------------- */

/** An event's links to the rest of its thread, in both directions. */
function linksOf(event, thread) {
  const byId = new Map(thread.map((other) => [other.id, other]));
  const links = [];
  for (const link of event.related || []) {
    const other = byId.get(link.id);
    if (other && other !== event)
      links.push({ other, reason: text(link.reason) });
  }
  for (const other of thread) {
    if (other === event) continue;
    for (const link of other.related || [])
      if (link.id === event.id)
        links.push({ other, reason: text(link.reason) });
  }
  return links;
}

const CHANGE_REASONS = new Set(['update', 'cleared']);
const sameItem = (a, b) => Boolean(a.key) && a.key === b.key;

/**
 * How a nested row relates to its thread: "Update" or "Cleared" for a later
 * change of the thread's own item, otherwise "Possibly related" with the
 * server's reason ("0.4 mi and 12 min apart"). Never a cause.
 */
function relationLabel(event, root, thread) {
  const links = linksOf(event, thread);
  const ofRoot =
    sameItem(event, root) ||
    links.some(
      ({ other, reason }) =>
        CHANGE_REASONS.has(reason) && (other === root || sameItem(other, root)),
    );
  // i18n-ignore: the Local panel is English-only county content.
  if (ofRoot) return event.change === 'cleared' ? 'Cleared' : 'Update';
  // The reason may sit on the first report of this item, not on its update.
  const siblings = thread.filter(
    (other) => other !== event && sameItem(other, event),
  );
  const reason = [event, ...siblings]
    .flatMap((member) => linksOf(member, thread))
    .filter(({ other }) => !sameItem(other, event))
    .sort((a, b) => (b.other === root) - (a.other === root))
    .map((link) => link.reason)
    .find((value) => value && !CHANGE_REASONS.has(value));
  const change =
    event.change === 'cleared'
      ? 'cleared'
      : event.change === 'update'
        ? 'update'
        : '';
  // i18n-ignore: the Local panel is English-only county content.
  return ['Possibly related', reason, change].filter(Boolean).join(' · ');
}

function threadsOf(events) {
  const groups = new Map();
  for (const event of events) {
    const id =
      typeof event.threadId === 'string' && event.threadId
        ? event.threadId
        : event.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(event);
  }
  return [...groups.entries()]
    .map(([id, members]) => {
      const story = [...members].sort(oldestFirst);
      const root = members.find((event) => event.id === id) ?? story[0];
      return {
        root,
        members,
        children: story.filter((event) => event !== root),
        newest: [...members].sort(newestFirst)[0],
        cleared: members.some(
          (event) =>
            event.change === 'cleared' &&
            (event === root || sameItem(event, root)),
        ),
      };
    })
    .sort((a, b) => newestFirst(a.newest, b.newest));
}

function rowHtml(event, now, { label = '', main = false } = {}) {
  const when = whenOf(event);
  const time = eventTimeText(when, now);
  const age = main ? ageText(when, now) : '';
  const place = text(event.place);
  const detail = text(event.detail);
  const source = text(event.source);
  const inner = [
    label ? `<span class="gev-events-rel">${escapeHtml(label)}</span>` : '',
    `<span class="gev-events-when">${
      time
        ? `<time datetime="${escapeHtml(new Date(when).toISOString())}">${escapeHtml(time)}</time>`
        : 'Time not stated'
    }${age ? ` <small class="gev-events-age">${escapeHtml(age)}</small>` : ''}</span>`,
    `<span class="gev-events-what">${eventIcon(event.kind)} <strong class="gev-events-title">${escapeHtml(titleOf(event))}</strong>${place ? ` · <span class="gev-events-place">${escapeHtml(place)}</span>` : ''}</span>`,
    detail
      ? `<span class="gev-events-detail">${escapeHtml(detail)}</span>`
      : '',
    `<small class="gev-events-source">${escapeHtml(source ? `Source: ${source}` : 'Source not stated')}</small>`,
  ]
    .filter(Boolean)
    .join(' ');
  const cls = `gev-events-row ${main ? 'gev-events-main' : 'gev-events-child'} tone-${severityOf(event)}`;
  return eventTarget(event)
    ? `<button type="button" class="${cls}" data-act="event" data-id="${escapeHtml(event.id)}">${inner}</button>`
    : `<div class="${cls}">${inner}</div>`;
}

function nowBoxHtml(data, events, now) {
  const summary = summaryOf(data) ?? { at: null, lines: [] };
  const time = eventTimeText(summary.at ?? toMs(data.generatedAt) ?? now, now);
  const known = new Set(events.map((event) => event.id));
  const lines = summary.lines.map((line) => {
    const tone = SUMMARY_TONES.has(line.tone) ? line.tone : 'ok';
    const source = text(line.source);
    const inner = `<span class="gev-events-now-text">${escapeHtml(text(line.text))}</span>${source ? ` <small class="gev-events-source">${escapeHtml(source)}</small>` : ''}`;
    const id = typeof line.eventId === 'string' ? line.eventId : '';
    return `<li class="gev-events-now-item">${
      id && known.has(id)
        ? `<button type="button" class="gev-events-now-line tone-${tone}" data-act="event" data-id="${escapeHtml(id)}">${inner}</button>`
        : `<span class="gev-events-now-line tone-${tone}">${inner}</span>`
    }</li>`;
  });
  // i18n-ignore: the Local panel is English-only county content.
  const quiet = `<li class="gev-events-now-item"><span class="gev-events-now-line tone-ok">Nothing notable in the feeds right now.</span></li>`;
  // i18n-ignore: the Local panel is English-only county content.
  return `<section class="gev-events-now" aria-label="Right now"><h3 class="gev-events-now-head">${escapeHtml(time ? `Right now · ${time}` : 'Right now')}</h3><ul class="gev-events-now-lines">${lines.join('') || quiet}</ul><p class="gev-events-note">${SAFETY_NOTE}</p></section>`;
}

/**
 * The Local panel's live events view: the "Right now" box, the timeline
 * grouped by thread (newest activity first; the thread's first event as the
 * main row, later changes and possibly related events nested under it), an
 * empty or unavailable state, and the sources that are not reporting.
 * @param {object|null} data an /api/local/events response (or mergeEvents())
 * @param {{now?: number, limit?: number}} [options] limit caps the rows
 */
export function eventTimelineHtml(data, { now = Date.now(), limit = 60 } = {}) {
  const at = nowMs(now);
  if (!isObject(data))
    // i18n-ignore: the Local panel is English-only county content.
    return `<div class="gev-events"><p class="gev-events-empty gev-events-unavailable" role="status">Live events are unavailable right now.</p><p class="gev-events-note">${SAFETY_NOTE}</p></div>`;
  const events = eventsOf(data);
  const cap = limitOf(limit, 60);
  const threads = [];
  let rows = 0;
  for (const thread of threadsOf(events)) {
    if (rows >= cap) break;
    const room = cap - rows - 1;
    const children = thread.children.slice(
      Math.max(0, thread.children.length - room),
    );
    const hidden = thread.children.length - children.length;
    rows += 1 + children.length;
    // Trimmed rows are changes and possibly related events alike: "entries".
    const nested = [
      hidden > 0
        ? // i18n-ignore: the Local panel is English-only county content.
          `<li class="gev-events-more">${hidden} earlier ${hidden === 1 ? 'entry' : 'entries'} not shown</li>`
        : '',
      ...children.map(
        (child) =>
          `<li>${rowHtml(child, at, { label: relationLabel(child, thread.root, thread.members) })}</li>`,
      ),
    ].join('');
    const rootLabel =
      thread.root.change === 'cleared'
        ? 'Cleared'
        : thread.root.change === 'update'
          ? 'Update'
          : '';
    threads.push(
      `<li class="gev-events-thread tone-${severityOf(thread.root)}${thread.cleared ? ' is-cleared' : ''}">${rowHtml(thread.root, at, { label: rootLabel, main: true })}${nested ? `<ul class="gev-events-children">${nested}</ul>` : ''}</li>`,
    );
  }
  const shown = Math.min(rows, events.length);
  const down = (sourcesOf(data) ?? [])
    .filter((source) => source.ok === false)
    .map((source) => text(source.name) || text(source.id))
    .filter(Boolean);
  return [
    '<div class="gev-events">',
    nowBoxHtml(data, events, at),
    threads.length
      ? `<ol class="gev-events-timeline" aria-label="Event timeline">${threads.join('')}</ol>`
      : '<p class="gev-events-empty" role="status">No events in the last 48 hours.</p>',
    shown < events.length
      ? `<p class="gev-events-more">Showing the latest ${shown} of ${events.length} events.</p>`
      : '',
    down.length
      ? `<p class="gev-events-sources">Not reporting: ${escapeHtml(down.join(', '))}</p>`
      : '',
    '</div>',
  ].join('');
}

/* ------------------------------ map target ------------------------------- */

function coordinate(value, max) {
  const n =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max
    ? n
    : null;
}

/**
 * Where a click on an event takes the map: { lat, lon, height, layers } with
 * the eye height for its kind, { layers } when it has a layer but no
 * position, or null when it has neither. A storm within 300 mi of Cape May
 * also switches the rain radar on.
 */
export function eventTarget(event) {
  if (!isObject(event)) return null;
  const layer = text(event.layer);
  const lat = coordinate(event.lat, 90);
  const lon = coordinate(event.lon, 180);
  const placed = lat !== null && lon !== null && !(lat === 0 && lon === 0);
  if (!placed && !layer) return null;
  const layers = layer ? [layer] : [];
  if (!placed) return { layers };
  if (
    event.kind === 'storm' &&
    !layers.includes('weather-radar') &&
    distanceKm(lat, lon, CAPE_MAY.lat, CAPE_MAY.lon) <=
      RADAR_RADIUS_MI * KM_PER_MI
  )
    layers.push('weather-radar');
  return { lat, lon, height: kindInfo(event.kind).height, layers };
}

/* -------------------------------- ticker --------------------------------- */

/**
 * The county ticker's LATEST item: the newest event that happened in the
 * last 60 minutes, or null. Clicking it opens the event (see ticker.js).
 * layerId is the event's own layer, or null when it has none: never a
 * stand-in layer that would show something else.
 */
export function latestTickerItem(data, now = Date.now()) {
  const at = nowMs(now);
  const event = eventsOf(data)
    .filter((candidate) => {
      const when = whenOf(candidate);
      return (
        when !== null &&
        at - when <= LATEST_WINDOW_MS &&
        when - at <= FUTURE_SKEW_MS
      );
    })
    .sort(newestFirst)[0];
  if (!event) return null;
  const time = eventTimeText(whenOf(event), at);
  const place = text(event.place);
  const headline = `${titleOf(event)}${place ? ` · ${place}` : ''}`;
  const source = text(event.source);
  // i18n-ignore: the county ticker is English-only county content.
  const tip = `${headline} (${source || 'source not stated'}${time ? `, ${time}` : ''})`;
  return {
    key: 'events',
    // i18n-ignore: the county ticker is English-only county content.
    label: 'LATEST',
    value: [time, headline].filter(Boolean).join(' '),
    detail: '',
    tone: severityOf(event),
    layerId: text(event.layer) || null,
    title: tip,
    eventId: event.id,
  };
}
