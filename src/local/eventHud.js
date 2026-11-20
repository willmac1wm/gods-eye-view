/**
 * The events HUD (#gev-events-hud): the Local panel's Alerts tab shrunk to
 * a small see-through box that stays over the map, like the message log in
 * a game. Its title strip says whether the feed is live and how many sources
 * report; the first row is the worst "Right now" line; then the newest
 * events, one line each, newest on top, dimmed after 30 minutes.
 *
 * Click a line to open it in place: its detail, source and age, the rest of
 * its thread (updates, cleared, possibly related) and "Fly to" and "More in
 * Alerts". Escape closes it again (on a phone, its card has a Close button).
 * New events slide in and count as unread until the HUD is hovered or
 * focused; a count never builds up while the pointer or the focus is
 * already on it.
 *
 * Screen readers: the visible list is a plain list. A separate, visually
 * hidden log announces each genuinely new event once, as one line of text;
 * opening, closing or refreshing a line, and the ages ticking on, are never
 * announced.
 *
 * Where it sits: its usual spot is over open map above the bottom dock
 * (panelWindow.hudAnchor), clear of the map credits, the MGRS readout and
 * HOME; dragged, it stays where it was dropped, kept whole on screen even
 * when an open line makes it taller (without moving the spot it remembers).
 * On phones it is a strip above every bottom control. Both are measured
 * again whenever those controls change.
 *
 * The HUD reads nothing itself: the Local shell owns the one events poller
 * and hands every answer to update(). Event text reaches the page escaped
 * and never in an attribute other than an escaped data-id.
 *
 * English-only county content, like the Local panel.
 */
import { escapeHtml } from './format.js';
import {
  EVENTS_SAFETY_NOTE,
  ageText,
  eventIcon,
  eventSeverity,
  eventTarget,
  eventThreadEntries,
  eventTimeText,
  eventTitle,
  eventWhen,
  newestEvents,
} from './eventFeed.js';
import {
  HUD_SIZE,
  KEEP_CLEAR,
  clampPosition,
  clearOfBottom,
  containPosition,
  hudAnchor,
  installDrag,
  phoneHudBottom,
} from './panelWindow.js';

/** The newest this many events show as lines. */
export const HUD_LINES = 8;
/** Lines older than this are dimmed. */
const OLD_AFTER_MS = 30 * 60_000;
/** The hidden announcer keeps this many lines (older ones are dropped). */
const ANNOUNCED_KEPT = 6;
/** Ids remembered as already seen, so only genuinely new events count. */
const KNOWN_MAX = 2000;
/** The spot is measured again this long after the controls below change. */
const REPLACE_DELAY_MS = 80;
const TONE_RANK = Object.freeze({ ok: 0, watch: 1, warn: 2, danger: 3 });
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const text = (value) =>
  value === null || value === undefined ? '' : String(value).trim();
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const toneOf = (line) =>
  Object.hasOwn(TONE_RANK, line?.tone) ? line.tone : 'ok';

/* -------------------------------- markup --------------------------------- */

/**
 * The title strip's state: LIVE with data and no failure, DELAYED when the
 * last refresh failed, OFFLINE when nothing ever loaded, LOADING before the
 * first answer; and "n of m sources" reporting. DELAYED too when the last
 * good read (live.readAt) is older than HUD_STALE_MS.
 * @param {{data: object|null, error?: string|null, readAt?: number}} live
 * @param {number} [now]
 */
/** Three 30 s refreshes without a good read. */
export const HUD_STALE_MS = 90_000;

export function hudStatus(live, now = Date.now()) {
  const data = isObject(live?.data) ? live.data : null;
  // No good read for three refreshes: what is shown may be old, so not LIVE.
  const readAt = Number(live?.readAt);
  const stale =
    Number.isFinite(readAt) && readAt > 0 && now - readAt > HUD_STALE_MS;
  const sources = Array.isArray(data?.sources)
    ? data.sources.filter(isObject)
    : [];
  const reporting = sources.filter((source) => source.ok !== false).length;
  const state = data
    ? live.error || stale
      ? 'delayed'
      : 'live'
    : live?.error
      ? 'offline'
      : 'loading';
  // i18n-ignore: the Local panel is English-only county content.
  const labels = {
    live: 'LIVE',
    delayed: 'DELAYED',
    offline: 'OFFLINE',
    loading: 'LOADING',
  };
  return {
    state,
    label: labels[state],
    sources: sources.length
      ? `${reporting} of ${sources.length} sources`
      : data
        ? // i18n-ignore: the Local panel is English-only county content.
          'County feeds'
        : '',
  };
}

const summaryLinesOf = (data) =>
  (Array.isArray(data?.summary?.lines) ? data.summary.lines : []).filter(
    (line) => isObject(line) && text(line.text),
  );

/** The summary line with the worst tone (the first of equals), or null. */
export function worstSummaryLine(data) {
  let worst = null;
  for (const line of summaryLinesOf(data))
    if (!worst || TONE_RANK[toneOf(line)] > TONE_RANK[toneOf(worst)])
      worst = line;
  return worst;
}

/**
 * The first row: the worst "Right now" line on one line; when expanded,
 * every summary line with its source, and the safety note.
 */
export function hudSummaryHtml(live, { expanded = false } = {}) {
  const data = isObject(live?.data) ? live.data : null;
  const lines = summaryLinesOf(data);
  const worst = worstSummaryLine(data);
  // i18n-ignore: the Local panel is English-only county content.
  const head = !data
    ? live?.error
      ? 'Live events are unavailable right now.'
      : 'Loading live events…'
    : worst
      ? text(worst.text)
      : 'Nothing notable in the feeds right now.';
  const tone = !data ? (live?.error ? 'warn' : 'ok') : toneOf(worst);
  const all = expanded
    ? `<div class="gev-hud-summary-all"><ul>${lines
        .map((line) => {
          const source = text(line.source);
          return `<li class="gev-hud-summary-line tone-${toneOf(line)}">${escapeHtml(text(line.text))}${source ? ` <small class="gev-hud-source">${escapeHtml(source)}</small>` : ''}</li>`;
        })
        .join(
          '',
        )}</ul><p class="gev-hud-note">${escapeHtml(EVENTS_SAFETY_NOTE)}</p></div>`
    : '';
  // i18n-ignore: the Local panel is English-only county content.
  return `<button type="button" class="gev-hud-summary tone-${tone}" data-hud="summary" aria-expanded="${expanded}"><span class="gev-hud-summary-label">Right now</span> <span class="gev-hud-summary-text">${escapeHtml(head)}</span></button>${all}`;
}

/** A line's own button content: time (Eastern), kind icon, title · place. */
function lineMainHtml(event, now) {
  const time = eventTimeText(eventWhen(event), now);
  const place = text(event.place);
  return `${
    time ? `<span class="gev-hud-time">${escapeHtml(time)}</span> ` : ''
  }${eventIcon(event.kind)} <span class="gev-hud-text"><strong class="gev-hud-title">${escapeHtml(eventTitle(event))}</strong>${
    place ? ` · <span class="gev-hud-place">${escapeHtml(place)}</span>` : ''
  }</span>`;
}

/**
 * An open line's detail: the detail, the source and an age slot (filled in
 * by the HUD, so a quiet minute never redraws it), the rest of its thread,
 * "Fly to" (or "Show on map" for an event with a layer but no position),
 * "More in Alerts", and "Close" (shown on phones, where there is no Escape).
 */
function lineDetailHtml(event, now, thread) {
  const id = escapeHtml(event.id);
  const detail = text(event.detail);
  const source = text(event.source);
  const target = eventTarget(event);
  const placed =
    target && Number.isFinite(target.lat) && Number.isFinite(target.lon);
  const threadHtml = thread.length
    ? `<ul class="gev-hud-thread">${thread
        .map(({ event: other, label }) => {
          const otherTime = eventTimeText(eventWhen(other), now);
          const otherPlace = text(other.place);
          // i18n-ignore: the Local panel is English-only county content.
          return `<li class="gev-hud-thread-item tone-${eventSeverity(other)}"><span class="gev-hud-rel">${escapeHtml(label)}</span> <span class="gev-hud-time">${escapeHtml(otherTime || 'Time not stated')}</span> ${eventIcon(other.kind)} ${escapeHtml(eventTitle(other))}${otherPlace ? ` · ${escapeHtml(otherPlace)}` : ''}</li>`;
        })
        .join('')}</ul>`
    : '';
  // i18n-ignore: the Local panel is English-only county content.
  const fly = target
    ? `<button type="button" class="gev-local-btn gev-hud-act" data-hud="fly" data-id="${id}">${placed ? 'Fly to' : 'Show on map'}</button>`
    : '';
  // i18n-ignore: the Local panel is English-only county content.
  return `<div class="gev-hud-detail">${
    detail ? `<p class="gev-hud-detail-text">${escapeHtml(detail)}</p>` : ''
  }<p class="gev-hud-meta"><span class="gev-hud-source">${escapeHtml(source ? `Source: ${source}` : 'Source not stated')}</span> <span class="gev-hud-age"></span></p>${threadHtml}<div class="gev-hud-actions">${fly}<button type="button" class="gev-local-btn is-quiet gev-hud-act" data-hud="more" data-id="${id}">More in Alerts</button><button type="button" class="gev-local-btn is-quiet gev-hud-act gev-hud-fold" data-hud="fold" data-id="${id}">Close</button></div></div>`;
}

/**
 * One event line: time (Eastern), kind icon, title · place. Expanded, it
 * also carries the detail (see lineDetailHtml).
 * @param {object} event
 * @param {{now?: number, expanded?: boolean, thread?: {event: object, label: string}[]}} [options]
 */
export function hudLineHtml(
  event,
  { now = Date.now(), expanded = false, thread = [] } = {},
) {
  const main = `<button type="button" class="gev-hud-line-main" data-hud="line" data-id="${escapeHtml(event.id)}" aria-expanded="${expanded}">${lineMainHtml(event, now)}</button>`;
  return expanded ? `${main}${lineDetailHtml(event, now, thread)}` : main;
}

/** What the hidden log says once for a new event: one plain line. */
export function hudAnnouncement(event, now = Date.now()) {
  const time = eventTimeText(eventWhen(event), now);
  const place = text(event.place);
  // i18n-ignore: the Local panel is English-only county content.
  return `New event: ${eventTitle(event)}${place ? ` · ${place}` : ''}${time ? `, ${time}` : ''}`;
}

// i18n-ignore: the Local panel is English-only county content.
const HUD_HTML = `
  <div class="gev-hud-head">
    <span class="gev-hud-grip" role="button" tabindex="0" aria-label="Move the events HUD, use arrow keys" title="Drag to move · Enter or double-click for the usual spot">⠿</span>
    <span class="gev-hud-dot" aria-hidden="true"></span>
    <strong class="gev-hud-state">LOADING</strong>
    <span class="gev-hud-sources"></span>
    <span class="gev-hud-unread" hidden></span>
    <button type="button" class="gev-hud-btn" data-hud="open" aria-label="Open Alerts" title="Open the full Alerts panel">Open Alerts</button>
    <button type="button" class="gev-hud-btn gev-hud-x" data-hud="close" aria-label="Close the events HUD" title="Close">×</button>
  </div>
  <div class="gev-hud-summary-box"></div>
  <ol class="gev-hud-lines ui-scroll" aria-label="Newest events"></ol>
  <p class="gev-hud-empty" hidden></p>
  <div class="gev-hud-announce" role="log" aria-live="polite" aria-relevant="additions" aria-label="New events"></div>`;

/* ------------------------------- behaviour ------------------------------- */

/**
 * Mount the HUD (hidden) at the end of the page.
 * @param {{doc?: Document, win?: Window, position?: {x: number, y: number}|null,
 *   isPhone?: () => boolean, now?: () => number, limit?: number,
 *   onFly?: (id: string) => void, onMore?: (id: string) => void,
 *   onOpen?: () => void, onClose?: () => void,
 *   onMove?: (position: {x: number, y: number}|null) => void,
 *   onShownChange?: (shown: boolean) => void}} [options]
 *   onFly: switch the event's layers on and fly there. onMore: open the
 *   Alerts tab at that event. onOpen: "Open Alerts". onClose: ×. onMove: the
 *   HUD was moved (null: back to its usual spot); store it. onShownChange:
 *   the page started or stopped showing the open HUD (clean view, cockpit,
 *   a phone sheet…), so the shell can start or stop its reads.
 */
export function createEventHud({
  doc = globalThis.document,
  win = doc?.defaultView ?? globalThis.window,
  position = null,
  isPhone = () => false,
  now = () => Date.now(),
  limit = HUD_LINES,
  onFly = () => {},
  onMore = () => {},
  onOpen = () => {},
  onClose = () => {},
  onMove = () => {},
  onShownChange = () => {},
} = {}) {
  const el = doc.createElement('section');
  el.id = 'gev-events-hud';
  el.className = 'gev-hud';
  el.hidden = true;
  // i18n-ignore: the Local panel is English-only county content.
  el.setAttribute('aria-label', 'Live events HUD');
  el.innerHTML = HUD_HTML;
  doc.body.appendChild(el);

  const head = el.querySelector('.gev-hud-head');
  const grip = el.querySelector('.gev-hud-grip');
  const stateEl = el.querySelector('.gev-hud-state');
  const sourcesEl = el.querySelector('.gev-hud-sources');
  const unreadEl = el.querySelector('.gev-hud-unread');
  const summaryBox = el.querySelector('.gev-hud-summary-box');
  const list = el.querySelector('.gev-hud-lines');
  const emptyEl = el.querySelector('.gev-hud-empty');
  const announcer = el.querySelector('.gev-hud-announce');

  let live = { data: null, error: null };
  let expandedId = null;
  let summaryOpen = false;
  let unread = 0;
  let hovered = false;
  /** After the first answer with data, more lines are new arrivals. */
  let primed = false;
  /** Every event id the HUD has had: only others are genuinely new. */
  let known = new Set();
  /** The spot the user chose (stored); null: the usual spot. */
  let pos =
    Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? { x: position.x, y: position.y }
      : null;
  let dragging = false;
  let summaryHtml = '';
  /** What each line's button and detail last showed. */
  const paintedMain = new WeakMap();
  const paintedDetail = new WeakMap();
  let reportedShown = false;
  let watchers = [];
  let replaceTimer = null;

  const viewport = () => ({
    w: win?.innerWidth || doc.documentElement?.clientWidth || 1024,
    h: win?.innerHeight || doc.documentElement?.clientHeight || 768,
  });
  /** Open: shown unless the page hides it (el.hidden is the HUD's own). */
  const open = () => !el.hidden;
  /** Shown on the page: open and not hidden by the CSS (clean view…). */
  const shown = () => {
    if (el.hidden) return false;
    try {
      return typeof el.checkVisibility === 'function'
        ? el.checkVisibility()
        : el.getClientRects().length > 0;
    } catch {
      return true;
    }
  };
  /** The pointer or the keyboard focus is on the HUD: it is being read. */
  const engaged = () => {
    if (hovered || el.contains(doc.activeElement)) return true;
    try {
      return el.matches(':hover');
    } catch {
      return false;
    }
  };
  const reducedMotion = () => {
    try {
      return Boolean(win?.matchMedia?.(REDUCED_MOTION)?.matches);
    } catch {
      return false;
    }
  };

  function paintUnread() {
    unreadEl.hidden = unread === 0;
    // i18n-ignore: the Local panel is English-only county content.
    unreadEl.textContent = unread ? `${unread} new` : '';
  }

  function clearUnread() {
    if (!unread) return;
    unread = 0;
    paintUnread();
  }

  function paintHead() {
    const status = hudStatus(live, now());
    el.dataset.state = status.state;
    if (stateEl.textContent !== status.label)
      stateEl.textContent = status.label;
    if (sourcesEl.textContent !== status.sources)
      sourcesEl.textContent = status.sources;
  }

  function paintSummary() {
    const html = hudSummaryHtml(live, { expanded: summaryOpen });
    if (html === summaryHtml) return;
    const focused = summaryBox.contains(doc.activeElement);
    summaryBox.innerHTML = html;
    summaryHtml = html;
    if (focused)
      summaryBox
        .querySelector('[data-hud="summary"]')
        ?.focus?.({ preventScroll: true });
  }

  const findEvent = (id) =>
    (Array.isArray(live.data?.events) ? live.data.events : []).find(
      (event) => isObject(event) && event.id === id,
    ) ?? null;

  /** A new line: its button, kept for as long as the line is. */
  function newLine(id) {
    const li = doc.createElement('li');
    li.dataset.id = id;
    const main = doc.createElement('button');
    main.type = 'button';
    main.className = 'gev-hud-line-main';
    main.dataset.hud = 'line';
    main.dataset.id = id;
    main.setAttribute('aria-expanded', 'false');
    li.appendChild(main);
    return li;
  }

  /**
   * Draw a line in place: its button keeps its element (and the focus) and
   * changes only what changed; the detail is added, redrawn or removed.
   */
  function paintLine(li, event, { at, expanded }) {
    const main = li.firstElementChild;
    const inner = lineMainHtml(event, at);
    if (paintedMain.get(main) !== inner) {
      main.innerHTML = inner;
      paintedMain.set(main, inner);
    }
    if (main.getAttribute('aria-expanded') !== String(expanded))
      main.setAttribute('aria-expanded', String(expanded));
    const old = li.querySelector(':scope > .gev-hud-detail');
    if (!expanded) {
      if (old) {
        if (old.contains(doc.activeElement))
          main.focus?.({ preventScroll: true });
        old.remove();
        paintedDetail.delete(li);
      }
      return;
    }
    const html = lineDetailHtml(
      event,
      at,
      eventThreadEntries(live.data, event.id),
    );
    if (old && paintedDetail.get(li) === html) return;
    const active = doc.activeElement;
    const keep =
      old && active && old.contains(active)
        ? { hud: active.dataset?.hud, id: active.dataset?.id }
        : null;
    const holder = doc.createElement('div');
    holder.innerHTML = html;
    const detail = holder.firstElementChild;
    if (old) old.replaceWith(detail);
    else li.appendChild(detail);
    paintedDetail.set(li, html);
    if (keep?.hud)
      [...detail.querySelectorAll(`[data-hud="${keep.hud}"]`)]
        .find((node) => node.dataset.id === keep.id)
        ?.focus?.({ preventScroll: true });
  }

  /** Say each new event once in the hidden log; drop the oldest lines. */
  function announce(events, at) {
    for (const event of events) {
      const line = doc.createElement('p');
      line.textContent = hudAnnouncement(event, at);
      announcer.appendChild(line);
    }
    while (announcer.children.length > ANNOUNCED_KEPT)
      announcer.firstElementChild.remove();
  }

  /**
   * Draw what `next` holds. Lines are kept by event id: an unchanged line is
   * not touched. Events the HUD has never had before are new: highlighted,
   * announced once, and counted unread unless the HUD is being read.
   * @param {{data: object|null, error?: string|null}} [next]
   */
  function update(next = live) {
    live = isObject(next)
      ? {
          data: isObject(next.data) ? next.data : null,
          error: next.error ?? null,
          readAt: Number.isFinite(Number(next.readAt))
            ? Number(next.readAt)
            : 0,
        }
      : { data: null, error: null, readAt: 0 };
    const at = now();
    paintHead();
    paintSummary();
    let events = [];
    try {
      events = live.data ? newestEvents(live.data, limit) : [];
    } catch {
      events = [];
    }
    // An event opened from the ticker may be older than the newest lines;
    // it shows too, but it is not news.
    let extra = null;
    if (expandedId && !events.some((event) => event.id === expandedId)) {
      extra = findEvent(expandedId);
      if (extra) events.push(extra);
      else expandedId = null;
    }
    const lines = new Map();
    for (const li of [...list.children]) lines.set(li.dataset.id, li);
    const counting = primed && shown();
    const arrived = [];
    let previous = null;
    for (const event of events) {
      const expanded = event.id === expandedId;
      let li = lines.get(event.id);
      if (li) lines.delete(event.id);
      else li = newLine(event.id);
      try {
        paintLine(li, event, { at, expanded });
      } catch {
        li.remove();
        continue;
      }
      const when = eventWhen(event);
      const isNew = counting && event !== extra && !known.has(event.id);
      if (isNew) arrived.push(event);
      li.className = [
        'gev-hud-line',
        `tone-${eventSeverity(event)}`,
        when !== null && at - when > OLD_AFTER_MS ? 'is-old' : '',
        expanded ? 'is-expanded' : '',
        isNew ? 'is-new' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const age = li.querySelector('.gev-hud-age');
      if (age) {
        const value = ageText(when, at);
        const wording = value ? `· ${value}` : '';
        if (age.textContent !== wording) age.textContent = wording;
      }
      const slot = previous ? previous.nextSibling : list.firstChild;
      if (li !== slot) list.insertBefore(li, slot);
      previous = li;
    }
    for (const li of lines.values()) li.remove();
    // i18n-ignore: the Local panel is English-only county content.
    const empty =
      live.data && !list.children.length
        ? 'No events in the last 48 hours.'
        : '';
    emptyEl.hidden = !empty;
    emptyEl.textContent = empty;
    if (live.data) {
      primed = true;
      if (known.size > KNOWN_MAX) known = new Set();
      for (const event of Array.isArray(live.data.events)
        ? live.data.events
        : [])
        if (isObject(event) && typeof event.id === 'string')
          known.add(event.id);
    }
    if (arrived.length) {
      announce(arrived, at);
      if (!engaged()) {
        unread += arrived.length;
        paintUnread();
      }
    }
    if (open()) place();
  }

  function lineOf(id) {
    return [...list.children].find((li) => li.dataset.id === id) ?? null;
  }

  function focusLine(id) {
    lineOf(id)
      ?.querySelector('[data-hud="line"]')
      ?.focus?.({ preventScroll: true });
  }

  /**
   * Open one event's line (the ticker's LATEST does this too). False when
   * the event is not loaded.
   */
  function expand(id, { focus = false } = {}) {
    if (typeof id !== 'string' || !findEvent(id)) return false;
    expandedId = id;
    update(live);
    const li = lineOf(id);
    li?.scrollIntoView?.({ block: 'nearest' });
    if (focus) focusLine(id);
    return true;
  }

  /** Close the open line; false when none was open. */
  function collapse({ focus = true } = {}) {
    if (!expandedId) return false;
    const id = expandedId;
    expandedId = null;
    update(live);
    if (focus) focusLine(id);
    return true;
  }

  function sizeNow() {
    const rect = el.getBoundingClientRect();
    return {
      w: rect.width > 0 ? rect.width : HUD_SIZE.w,
      h: rect.height > 0 ? rect.height : HUD_SIZE.h,
    };
  }

  /**
   * Show the HUD at a spot: during a drag it may hang off the right or the
   * bottom; at rest it is kept whole on screen and above what must stay in
   * view below it (the credits, the MGRS readout, HOME, the dock). Returns
   * where it went.
   */
  function showAt(spot, { drag = false } = {}) {
    const size = sizeNow();
    const at = drag
      ? clampPosition(spot, size, viewport())
      : clearOfBottom(
          doc,
          viewport(),
          containPosition(spot, size, viewport()),
          size,
        );
    const style = el.style;
    el.classList.add('is-placed');
    style.removeProperty('--gev-hud-max-h');
    style.left = `${at.x}px`;
    style.top = `${at.y}px`;
    return at;
  }

  /**
   * Where the HUD sits: the spot it was dragged to (kept whole on screen,
   * even when an open line makes it taller; the spot itself is unchanged),
   * its usual spot over open map, or the phone strip above every bottom
   * control.
   */
  function place() {
    const style = el.style;
    if (isPhone()) {
      el.classList.remove('is-placed');
      style.removeProperty('left');
      style.removeProperty('top');
      style.removeProperty('--gev-hud-max-h');
      const bottom = phoneHudBottom(doc, viewport());
      if (bottom === null) style.removeProperty('--gev-hud-phone-bottom');
      else style.setProperty('--gev-hud-phone-bottom', `${bottom}px`);
      return;
    }
    if (pos) {
      if (!dragging) showAt(pos);
      return;
    }
    el.classList.remove('is-placed');
    style.removeProperty('left');
    style.removeProperty('top');
    const anchor = hudAnchor(doc, viewport(), sizeNow());
    style.setProperty('--gev-hud-left', `${anchor.left}px`);
    style.setProperty('--gev-hud-bottom', `${anchor.bottom}px`);
    style.setProperty('--gev-hud-max-h', `${anchor.maxHeight}px`);
  }

  function ensurePosition() {
    if (pos) return;
    const rect = el.getBoundingClientRect();
    pos = { x: rect.left, y: rect.top };
  }

  /** The grip (on a phone, "Open Alerts", as the strip has no grip). */
  function focusGrip() {
    (isPhone() ? el.querySelector('[data-hud="open"]') : grip)?.focus?.({
      preventScroll: true,
    });
  }

  function backToUsualSpot() {
    pos = null;
    place();
    onMove(null);
  }

  /** Tell the shell when the page starts or stops showing the open HUD. */
  function reportShown() {
    const showing = shown();
    if (showing === reportedShown) return;
    reportedShown = showing;
    onShownChange(showing);
  }

  /**
   * While open, follow the controls below it (the voice dock opening, the
   * tab bar, a world timeline) and the page's modes (clean view, cockpit,
   * phone sheets): measure the spot again, and report showing or not.
   */
  function watch() {
    unwatch();
    const later = () => {
      clearTimeout(replaceTimer);
      replaceTimer = setTimeout(() => {
        if (!open()) return;
        place();
        reportShown();
      }, REPLACE_DELAY_MS);
    };
    const Resize = win?.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof Resize === 'function')
      try {
        const resize = new Resize(later);
        for (const node of doc.querySelectorAll(KEEP_CLEAR))
          resize.observe(node);
        watchers.push(resize);
      } catch {
        /* the spot is still measured on show, update and resize */
      }
    const Mutation = win?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof Mutation === 'function')
      try {
        const mutation = new Mutation(later);
        mutation.observe(doc.body, {
          attributes: true,
          attributeFilter: ['class', 'data-mobile-sheet'],
          childList: true,
        });
        watchers.push(mutation);
      } catch {
        /* as above */
      }
  }

  function unwatch() {
    clearTimeout(replaceTimer);
    for (const watcher of watchers) watcher.disconnect?.();
    watchers = [];
  }

  const disposeDrag = installDrag({
    area: head,
    keyHandle: grip,
    enabled: () => open() && !isPhone(),
    getRect: () => el.getBoundingClientRect(),
    onStart: () => {
      dragging = true;
      ensurePosition();
    },
    onMove: ({ clientX, clientY, state }) => {
      pos = showAt(
        { x: clientX - state.grabX, y: clientY - state.grabY },
        { drag: true },
      );
    },
    onEnd: () => {
      dragging = false;
      // At rest again: the whole HUD back on screen.
      pos = showAt(pos);
      onMove({ ...pos });
    },
    onKey: (dx, dy) => {
      ensurePosition();
      pos = showAt({ x: pos.x + dx, y: pos.y + dy });
      onMove({ ...pos });
    },
    onActivate: backToUsualSpot,
    onDoubleClick: backToUsualSpot,
  });

  const onClick = (event) => {
    const control = event.target?.closest?.('[data-hud]');
    if (!control || !el.contains(control)) return;
    const id = control.dataset.id;
    switch (control.dataset.hud) {
      case 'open':
        onOpen();
        break;
      case 'close':
        onClose();
        break;
      case 'summary':
        summaryOpen = !summaryOpen;
        paintSummary();
        if (open()) place();
        break;
      case 'line':
        if (expandedId === id) collapse();
        else expand(id, { focus: true });
        break;
      case 'fly':
        onFly(id);
        // On a phone the card would hide the map it just flew to.
        if (isPhone() && expandedId === id) collapse();
        break;
      case 'more':
        onMore(id);
        break;
      case 'fold':
        collapse();
        break;
      default:
        break;
    }
  };
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return;
    if (collapse()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onResize = () => {
    if (open()) place();
  };
  const onEnter = () => {
    hovered = true;
    clearUnread();
  };
  const onLeave = () => {
    hovered = false;
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('focusin', clearUnread);
  win?.addEventListener?.('resize', onResize);

  return {
    el,
    /** Open (the HUD's own state), whether or not the page shows it. */
    isOpen: open,
    /** Shown on the page: open, and not hidden by the CSS. */
    isShown: shown,
    /** Fill it (while still hidden, so nothing is announced) and show it. */
    show(next = live) {
      el.classList.toggle('is-reduced-motion', reducedMotion());
      update(next);
      el.hidden = false;
      place();
      watch();
      reportedShown = shown();
    },
    hide() {
      el.hidden = true;
      unwatch();
      reportedShown = false;
      expandedId = null;
      summaryOpen = false;
      unread = 0;
      hovered = false;
      paintUnread();
    },
    update,
    expand,
    collapse,
    place,
    /** Focus the grip (on a phone, "Open Alerts"). */
    focus: focusGrip,
    /**
     * Focus one of the HUD's controls ({hud: 'open'}, {hud: 'more', id}…),
     * else that event's line, else the grip.
     */
    focusControl({ hud, id } = {}) {
      const match = [...el.querySelectorAll('[data-hud]')].find(
        (node) =>
          node.dataset.hud === hud &&
          (id === undefined || node.dataset.id === id),
      );
      const target =
        match ??
        (id ? lineOf(id)?.querySelector('[data-hud="line"]') : null) ??
        null;
      if (target) target.focus?.({ preventScroll: true });
      else focusGrip();
    },
    get unread() {
      return unread;
    },
    get expandedId() {
      return expandedId;
    },
    get position() {
      return pos ? { ...pos } : null;
    },
    destroy() {
      unwatch();
      disposeDrag();
      el.removeEventListener('click', onClick);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('focusin', clearUnread);
      win?.removeEventListener?.('resize', onResize);
      el.remove();
    },
  };
}
