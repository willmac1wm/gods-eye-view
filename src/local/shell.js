/**
 * Local awareness shell: the shared details window, the active-alert chip
 * and the Local panel (Alerts · Calls · County · News · My Town · Report ·
 * Replay). Plain DOM, mounted once for the application lifetime.
 *
 * Every list shows its source, when it was updated and its status, and has
 * explicit loading, empty, delayed and error states.
 */
import * as Cesium from 'cesium';
import { normalizePitchDeg } from '../share/cameraParams.js';
import { incidentFlyTarget } from './incidentLink.js';
import { signInHref } from '../share/returnView.js';
import { fetchLocal } from './api.js';
import { initDetailsPanel, openRecord } from './detailsPanel.js';
import {
  escapeHtml,
  statusBadge,
  whenText,
  relativeTime,
  easternTime,
} from './format.js';
import {
  clearMyTown,
  getMyTown,
  locateNearMe,
  nearMyTown,
  setMyTown,
  setMyTownOptions,
  subscribeMyTown,
  townChoices,
} from './myTown.js';
import {
  LOCAL_LAYER_DEFINITIONS,
  atcRecord,
  callRecord,
} from '../layers/localFeatures/definitions.js';
import { isPanelHiddenLayer } from '../ui/panelHiddenLayers.js';
import { installCountyTicker } from './ticker.js';
import { installAccountMenu } from './accountMenu.js';
import { installWatchPanel } from './watchPanel.js';
import {
  eventCrawlHtml,
  eventTarget,
  eventThreadId,
  eventTimeText,
  eventTimelineHtml,
  loadEvents,
  mergeEvents,
} from './eventFeed.js';
import { dashboardHtml, loadDashboard } from './countyDashboard.js';
import {
  createPanelWindow,
  windowControlsHtml,
  windowGripHtml,
} from './panelWindow.js';
import { createEventHud } from './eventHud.js';

const TABS = [
  ['alerts', 'Alerts'],
  ['calls', 'Calls'],
  ['county', 'County'],
  ['news', 'News'],
  ['town', 'My Town'],
  ['report', 'Report'],
  ['replay', 'Replay'],
];
const DEF = Object.fromEntries(LOCAL_LAYER_DEFINITIONS.map((d) => [d.id, d]));

/**
 * "Show on map" switches each tab carries, as [layer id, label]. Layers that
 * left the Data Layers list (src/ui/panelElsewhereLayers.js) are switched on
 * and off here; the County dashboard's cards (countyDashboard.js) carry the
 * rest of them.
 */
export const LOCAL_TAB_TOGGLES = Object.freeze({
  calls: Object.freeze([
    Object.freeze(['airport-radio', 'airport radio']),
    Object.freeze(['vdl2', 'aircraft datalink (VDL2)']),
  ]),
  county: Object.freeze([
    Object.freeze(['county-risk', 'county risk']),
    Object.freeze(['readiness', 'readiness kit']),
  ]),
  news: Object.freeze([
    Object.freeze(['daily-brief', 'daily brief']),
    Object.freeze(['credibility-scoring', 'source credibility']),
  ]),
  replay: Object.freeze([Object.freeze(['history-replay', 'history replay'])]),
});

let viewer = null;
let dataManager = null;
let panel = null;
let chip = null;
let activeTab = 'alerts';
let renderToken = 0;
let chipTimer = null;
let chipDismissedFor = null;
let replay = { audio: null, queue: [], index: -1 };
let callFilter = 'all';

/** Live events on the Alerts tab: re-read every 30 s while that tab shows. */
const EVENTS_REFRESH_MS = 30_000;
/** After failures the refresh backs off, doubling, to at most 5 minutes. */
const EVENTS_MAX_DELAY_MS = 5 * 60_000;
/**
 * A refresh asks for what the server saw since its last answer, reaching
 * back a minute so nothing seen during that answer is missed; an event that
 * comes again is de-duplicated by id (mergeEvents).
 */
const EVENTS_SINCE_OVERLAP_MS = 60_000;
/** Timeline rows shown at first; "Show more events" adds more. */
const EVENTS_ROWS = 25;
const EVENTS_ROWS_STEP = 50;
/** The crawl moves about this fast, whatever its length. */
const CRAWL_PX_PER_SECOND = 40;
/** Phones: the Local panel is a bottom sheet over the map (local.css). */
const PHONE_QUERY = '(max-width: 720px)';

/** The last good events answer (merged), and why the last read failed. */
let liveEvents = { data: null, error: null };
let eventsTimer = null;
let eventsAbort = null;
/** The draw (renderToken) whose Alerts tab finished drawing its events. */
let alertsDrawnToken = null;
/** The panel's window (panelWindow.js) and the events HUD (eventHud.js). */
let windowCtl = null;
let hud = null;
/**
 * The panel was opened from the HUD (or while it was open): closing the
 * panel brings the HUD back, with this HUD control focused
 * ({hud: 'open'}, {hud: 'more', id} or {hud: 'grip'}).
 */
let hudReturn = null;
/** When the events were last read (this browser's clock), for staleness. */
let eventsReadAt = 0;
/** "More in Alerts": the marked thread stops glowing after this long. */
const HIGHLIGHT_MS = 2400;
let highlightTimer = null;
let eventsFailures = 0;
let eventsRows = EVENTS_ROWS;
/** The event last opened from the panel or the ticker: its row is marked. */
let selectedEventId = null;
/** An event the ticker asked for before the Alerts tab had loaded it. */
let pendingEvent = null;
/** What each events box last showed, so an unchanged crawl keeps moving. */
const paintedHtml = new WeakMap();
let appConfig = {
  aiChatEnabled: true,
  settings: {
    bannerText: '',
    bannerSeverity: 'info',
    defaultTown: '',
    reportsOpen: true,
  },
  layers: {},
  auth: { authenticated: false, user: null },
};

function isLayerHiddenByManager(id) {
  return Boolean(appConfig?.layers?.[id]?.hidden);
}

function applyAiChatVisibility(enabled) {
  document.documentElement.dataset.aiChatDisabled = enabled ? '0' : '1';
  let styleEl = document.getElementById('gev-manager-ai-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'gev-manager-ai-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = enabled
    ? ''
    : '[data-panel="chat"], .chat-panel, .voice-button, [aria-label*="AI Chat" i], [aria-label*="Voice" i] { display: none !important; }';
}

const badge = (status) => {
  const b = statusBadge(status);
  return `<span class="gev-local-badge" data-tone="${b.tone}">${escapeHtml(b.text)}</span>`;
};

function metaLine(env) {
  const fetched = env.fetchedAt ? relativeTime(env.fetchedAt) : 'never';
  return `<div class="gev-local-meta">${badge(env.status)}<span>Source: ${escapeHtml(env.source?.name || 'unknown')}</span><span>Updated ${escapeHtml(fetched)}</span></div>${
    env.note ? `<p class="gev-local-note">${escapeHtml(env.note)}</p>` : ''
  }`;
}

const loadingHtml = (what) =>
  `<div class="gev-local-empty" role="status">Loading ${escapeHtml(what)}…</div>`;
const errorHtml = (what, error) =>
  `<div class="gev-local-empty gev-local-error" role="alert">Could not load ${escapeHtml(what)}: ${escapeHtml(error?.message || 'unknown error')}.<br /><button type="button" class="gev-local-btn" data-act="retry" style="margin-top:10px">Try again</button></div>`;

function setLayer(id, on) {
  // Local defaults never switch on a layer the Data Layers list hides.
  if (on && isPanelHiddenLayer(id)) return null;
  try {
    return dataManager?.setEnabled?.(id, on, { origin: 'user' });
  } catch {
    return null;
  }
}
const layerOn = (id) => Boolean(dataManager?.isEnabled?.(id));

/**
 * A layer switch's text: "Show tide gauges on map" / "Tide gauges: on map",
 * or with `short` (a dashboard card already names the layer) "Show on map" /
 * "On map".
 */
function layerToggleText(label, on, short) {
  if (short) return on ? 'On map' : 'Show on map';
  return on ? `${label}: on map` : `Show ${label} on map`;
}

/**
 * A "Show on map" switch. The label rides along in data-label so the switch
 * keeps its own wording after a click (see paintLayerButton).
 * @param {string} id layer id
 * @param {string} label what the switch shows, in a sentence
 * @param {{short?: boolean}} [options]
 */
function layerToggleHtml(id, label, { short = false } = {}) {
  const on = layerOn(id);
  return `<button type="button" class="gev-local-btn${on ? ' is-active' : ''}" data-act="layer" data-layer="${escapeHtml(id)}" data-label="${escapeHtml(label)}"${short ? ` data-short="1" title="${escapeHtml(`${label} on the map`)}"` : ''} aria-pressed="${on}">${escapeHtml(layerToggleText(label, on, short))}</button>`;
}

/** Bring one switch in line with its layer (after a click or an event). */
function paintLayerButton(el) {
  const id = el.dataset.layer;
  const on = layerOn(id);
  el.classList.toggle('is-active', on);
  el.setAttribute('aria-pressed', String(on));
  el.textContent = layerToggleText(
    el.dataset.label || DEF[id]?.name || id,
    on,
    el.dataset.short === '1',
  );
}

function syncLayerButtons() {
  panel?.querySelectorAll('[data-act="layer"]').forEach(paintLayerButton);
}

/** A tab's own row of switches (LOCAL_TAB_TOGGLES). */
function tabTogglesHtml(tab, extraClass = '') {
  const toggles = LOCAL_TAB_TOGGLES[tab] || [];
  return toggles.length
    ? `<div class="gev-local-chiprow${extraClass ? ` ${extraClass}` : ''}">${toggles
        .map(([id, label]) => layerToggleHtml(id, label))
        .join('')}</div>`
    : '';
}

function isPhone() {
  try {
    return Boolean(window.matchMedia?.(PHONE_QUERY)?.matches);
  } catch {
    return false;
  }
}

// ----------------------------------------------------------- live events
/*
 * The Alerts tab leads with the live events feed (/api/local/events, see
 * eventFeed.js): a crawl of the newest events, the "Right now" box and the
 * threaded timeline. A click on any event switches on the layers that show
 * it and flies there. The events HUD (eventHud.js) shows the same feed.
 *
 * One poller serves both: while the Alerts tab or the HUD shows, a refresh
 * every 30 s asks only for what changed (?since=), merges it in and paints
 * whichever of them is showing. It stops when neither shows and pauses while
 * the browser tab is hidden.
 */

function findEvent(id) {
  if (typeof id !== 'string' || !id) return null;
  const events = liveEvents.data?.events;
  return Array.isArray(events)
    ? (events.find((event) => event.id === id) ?? null)
    : null;
}

/** Keep a read's answer: a full read replaces, a ?since= read merges. */
function takeEvents(result, { full = false } = {}) {
  if (result?.ok && result.data) {
    liveEvents = {
      data: mergeEvents(full ? null : liveEvents.data, result.data),
      error: null,
    };
    eventsReadAt = Date.now();
    eventsFailures = 0;
  } else {
    liveEvents = {
      ...liveEvents,
      error: result?.error || 'Events request failed',
    };
    eventsFailures += 1;
  }
}

function stopEventsRefresh() {
  clearTimeout(eventsTimer);
  eventsTimer = null;
  eventsAbort?.abort();
  eventsAbort = null;
}

function newEventsSignal() {
  eventsAbort?.abort();
  eventsAbort = new AbortController();
  return eventsAbort.signal;
}

/** Whether the Alerts tab's events are drawn and showing. */
const alertsShowing = () =>
  alertsDrawnToken !== null &&
  alertsDrawnToken === renderToken &&
  Boolean(panel) &&
  !panel.hidden &&
  activeTab === 'alerts';
/**
 * Whether the HUD is on the page: open and not hidden by the CSS (clean
 * view, cockpit, scene playback, a phone sheet). A HUD nobody can see
 * reads nothing.
 */
const hudShowing = () => Boolean(hud?.isShown());
/** The poller runs while one of its two readers shows. */
const eventsWanted = () => alertsShowing() || hudShowing();
const pageHidden = () => document.visibilityState === 'hidden';
/** No events yet, or the last read is older than one refresh. */
const eventsStale = () =>
  !liveEvents.data || !(Date.now() - eventsReadAt <= EVENTS_REFRESH_MS);
/** What the HUD shows, with when the last good read landed (for DELAYED). */
const hudLive = () => ({ ...liveEvents, readAt: eventsReadAt });
/**
 * A stalled poller never shows as LIVE: with the HUD up, every refresh
 * interval the HUD re-checks its status, and a poller with nothing scheduled
 * and no read for three intervals is started again.
 */
function eventsWatchdog() {
  if (!hudShowing() || pageHidden()) return;
  hud.update(hudLive());
  if (!eventsTimer && Date.now() - eventsReadAt > 3 * EVENTS_REFRESH_MS)
    syncEventsPoller({ now: true });
}
/** A refresh started from a timer or a sync never rejects unheard. */
const refreshSoon = () => {
  refreshEvents().catch(() => {});
};

function scheduleEventsRefresh() {
  clearTimeout(eventsTimer);
  eventsTimer = null;
  // A background browser tab reads nothing; visibilitychange resumes it.
  if (!eventsWanted() || pageHidden()) return;
  const delay = Math.min(
    EVENTS_REFRESH_MS * 2 ** Math.min(eventsFailures, 4),
    EVENTS_MAX_DELAY_MS,
  );
  eventsTimer = setTimeout(refreshSoon, delay);
}

/**
 * One read of the shared poller. Whatever goes wrong while reading or
 * painting, the next read is still scheduled (unless this read was aborted:
 * whoever aborted it owns what comes next), so the poller cannot stop for
 * good on one bad answer.
 */
async function refreshEvents() {
  eventsTimer = null;
  let signal = null;
  try {
    if (!eventsWanted() || pageHidden()) return;
    signal = newEventsSignal();
    const generatedAt = liveEvents.data?.generatedAt;
    const since = Number.isFinite(generatedAt)
      ? generatedAt - EVENTS_SINCE_OVERLAP_MS
      : undefined;
    const result = await loadEvents({ signal, since });
    if (signal.aborted || !eventsWanted()) return;
    takeEvents(result, { full: since === undefined });
    paintEverywhere();
  } finally {
    if (signal && eventsAbort?.signal === signal) eventsAbort = null;
    if (!signal?.aborted) scheduleEventsRefresh();
  }
}

/** Paint the live events wherever they show: the Alerts tab, the HUD. */
function paintEverywhere() {
  if (alertsShowing()) paintEvents(panel.querySelector('.gev-local-body'));
  if (hudShowing()) hud.update(hudLive());
}

/**
 * Start or stop the one events poller to match what shows. `now` reads at
 * once (the HUD opening with nothing loaded, the page coming back).
 */
function syncEventsPoller({ now = false } = {}) {
  if (!eventsWanted()) {
    stopEventsRefresh();
    return;
  }
  if (pageHidden()) {
    clearTimeout(eventsTimer);
    eventsTimer = null;
    return;
  }
  if (now) {
    clearTimeout(eventsTimer);
    eventsTimer = null;
    refreshSoon();
    return;
  }
  if (!eventsTimer && !eventsAbort) scheduleEventsRefresh();
}

/**
 * The browser tab hidden: the next refresh is not scheduled (a read already
 * on its way may land). Shown again: catch up at once.
 */
function onPageVisibility() {
  if (pageHidden()) {
    clearTimeout(eventsTimer);
    eventsTimer = null;
    return;
  }
  if (eventsWanted()) syncEventsPoller({ now: true });
}

/** Replace a box's markup only when it changed; keep keyboard focus. */
function paintBox(box, html) {
  if (!box || paintedHtml.get(box) === html) return false;
  const active = document.activeElement;
  const focusId =
    active && box.contains(active) && active.dataset?.act === 'event'
      ? active.dataset.id
      : null;
  box.innerHTML = html;
  paintedHtml.set(box, html);
  if (focusId)
    [...box.querySelectorAll('[data-act="event"]')]
      .find(
        (el) => el.dataset.id === focusId && !el.hasAttribute('aria-hidden'),
      )
      ?.focus?.({ preventScroll: true });
  return true;
}

/**
 * The crawl loops by moving its track left by half (the items are drawn
 * twice), at about 40 px a second. When one copy fits the box it stands
 * still instead.
 */
function sizeCrawl(box) {
  const crawl = box?.querySelector('.gev-events-crawl');
  const track = crawl?.querySelector('.gev-events-crawl-track');
  if (!track) return;
  const copyWidth = track.scrollWidth / 2;
  const items = track.querySelectorAll(
    '.gev-events-crawl-item:not([aria-hidden])',
  ).length;
  crawl.classList.toggle(
    'is-static',
    copyWidth > 0 && copyWidth <= crawl.clientWidth,
  );
  const seconds =
    copyWidth > 0 ? copyWidth / CRAWL_PX_PER_SECOND : Math.max(1, items) * 6;
  track.style.setProperty(
    '--gev-crawl-duration',
    `${Math.max(12, Math.round(seconds))}s`,
  );
}

function markSelected(root) {
  root
    ?.querySelectorAll('.gev-events-row.is-selected')
    .forEach((el) => el.classList.remove('is-selected'));
  if (!selectedEventId) return null;
  const row = [
    ...(root?.querySelectorAll('.gev-events-row[data-act="event"]') || []),
  ].find((el) => el.dataset.id === selectedEventId);
  row?.classList.add('is-selected');
  return row ?? null;
}

function eventsMetaHtml() {
  const sources = liveEvents.data?.sources || [];
  const reporting = sources.filter((s) => s?.ok !== false).length;
  const drawer = sources.length
    ? `<details class="gev-local-fold" style="margin:2px 0 6px"><summary style="cursor:pointer;font-size:11px;opacity:0.85">Sensor fusion stack (${reporting}/${sources.length} active)</summary><ul style="margin:4px 0 0;padding-left:16px;font-size:11px">${sources
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.name || s.id)}</strong> · ${s?.ok !== false ? 'LIVE' : 'OFFLINE'}${s?.at ? ` (${escapeHtml(relativeTime(s.at))})` : ''}</li>`,
        )
        .join('')}</ul></details>`
    : '';
  return `<div class="gev-local-meta">${badge(liveEvents.data ? (liveEvents.error ? 'delayed' : 'live') : 'unavailable')}<span>${
    sources.length
      ? `${reporting} of ${sources.length} sources reporting`
      : 'County feeds'
  }</span><span>Refreshes every 30 s</span></div>${drawer}`;
}

/** The crawl and timeline markup for liveEvents (may throw on odd data). */
function eventsParts(now) {
  const { data, error } = liveEvents;
  const total = Array.isArray(data?.events) ? data.events.length : 0;
  const lastAt = data ? eventTimeText(data.generatedAt, now) : '';
  // i18n-ignore: the Local panel is English-only county content.
  const stale =
    data && error
      ? `<p class="gev-local-note" role="status">Live events could not refresh just now${lastAt ? `; this is the update from ${escapeHtml(lastAt)}` : ''}. Trying again shortly.</p>`
      : '';
  // i18n-ignore: the Local panel is English-only county content.
  const more =
    total > eventsRows
      ? '<button type="button" class="gev-local-btn is-quiet gev-events-more-btn" data-act="events-more">Show more events</button>'
      : '';
  return {
    crawl: data ? eventCrawlHtml(data, { now }) : '',
    timeline: `${stale}${eventTimelineHtml(data, { now, limit: eventsRows })}${more}`,
  };
}

/**
 * Draw the live events part of the Alerts tab from liveEvents. An event the
 * page cannot draw blanks only this part, never the NWS list below it.
 */
function paintEvents(root) {
  if (!root) return;
  const now = Date.now();
  paintBox(root.querySelector('[data-part="events-meta"]'), eventsMetaHtml());
  let parts;
  try {
    parts = eventsParts(now);
  } catch {
    // i18n-ignore: the Local panel is English-only county content.
    parts = {
      crawl: '',
      timeline:
        '<p class="gev-local-empty gev-local-error" role="status">Live events could not be shown right now.</p>',
    };
  }
  const crawlBox = root.querySelector('[data-part="crawl"]');
  if (paintBox(crawlBox, parts.crawl)) sizeCrawl(crawlBox);
  paintBox(root.querySelector('[data-part="timeline"]'), parts.timeline);
  markSelected(root.querySelector('[data-part="timeline"]'));
}

/**
 * Open one event: switch on each layer that shows it (setLayer refuses a
 * hidden one) and fly to it when it has a position. On a phone the panel
 * closes so the map is in view (`closeOnPhone: false` from the HUD, where
 * the panel is closed already). False when the event is not loaded.
 */
function activateEvent(id, { closeOnPhone = true } = {}) {
  const event = findEvent(id);
  if (!event) return false;
  selectedEventId = id;
  markSelected(panel?.querySelector('[data-part="timeline"]'));
  const target = eventTarget(event);
  if (!target) return true;
  const switching = target.layers
    .filter((layer) => !layerOn(layer))
    .map((layer) => setLayer(layer, true));
  Promise.allSettled(switching).then(syncLayerButtons);
  if (Number.isFinite(target.lat) && Number.isFinite(target.lon))
    flyTo(target.lat, target.lon, target.height);
  if (closeOnPhone && isPhone()) closeLocalPanel();
  return true;
}

/**
 * The ticker's LATEST item: open that event as if it were clicked in the
 * Alerts tab. A loaded event opens at once; otherwise the events are read
 * first (on wide screens by the Alerts tab itself). On wide screens the tab
 * opens with its row marked; on a phone only the map moves, as after a
 * click in the panel. An event that cannot be found opens the Alerts tab.
 */
async function openEventFromTicker(id) {
  if (!panel || typeof id !== 'string' || !id) return;
  // The HUD is up: open the event in it and fly there; the panel stays shut.
  if (hudShowing()) {
    if (!findEvent(id)) {
      const result = await loadEvents();
      if (!panel || !hudShowing()) return;
      if (result.ok) {
        takeEvents(result);
        hud.update(hudLive());
      }
    }
    if (findEvent(id) && hud.expand(id)) {
      activateEvent(id, { closeOnPhone: false });
      return;
    }
  }
  if (!findEvent(id) && isPhone()) {
    const result = await loadEvents();
    if (!panel) return;
    if (result.ok) takeEvents(result, { full: true });
  }
  if (findEvent(id)) {
    activateEvent(id);
    if (isPhone()) return;
    pendingEvent = { id, activate: false };
  } else {
    pendingEvent = { id, activate: true };
  }
  openLocalPanel('alerts');
}

/** After the Alerts tab draws: open or mark what the ticker asked for. */
function settlePendingEvent(body) {
  const pending = pendingEvent;
  pendingEvent = null;
  if (!pending) return;
  if (pending.activate && !activateEvent(pending.id)) return;
  if (panel?.hidden) return;
  selectedEventId = pending.id;
  const timeline = body.querySelector('[data-part="timeline"]');
  const row = markSelected(timeline);
  // "More in Alerts" from the HUD: the event's thread is marked, even for
  // an event with nowhere to fly (its row is not a button).
  const threadId = eventThreadId(liveEvents.data, pending.id);
  const thread =
    row?.closest?.('.gev-events-thread') ??
    [...(timeline?.querySelectorAll('.gev-events-thread[data-id]') || [])].find(
      (el) => el.dataset.id === threadId,
    );
  highlightThread(timeline, thread);
  (row ?? thread)?.scrollIntoView?.({ block: 'center' });
  if (row) row.focus?.({ preventScroll: true });
  else if (thread) {
    // No row to press: the screen reader is taken to the thread itself.
    thread.setAttribute('tabindex', '-1');
    thread.focus?.({ preventScroll: true });
  }
}

/** Mark one thread for a moment; an earlier mark is cleared first. */
function highlightThread(timeline, thread) {
  clearTimeout(highlightTimer);
  highlightTimer = null;
  timeline
    ?.querySelectorAll('.gev-events-thread.is-highlighted')
    .forEach((el) => el.classList.remove('is-highlighted'));
  if (!thread) return;
  thread.classList.add('is-highlighted');
  highlightTimer = setTimeout(() => {
    highlightTimer = null;
    thread.classList.remove('is-highlighted');
  }, HIGHLIGHT_MS);
}

function nwsHtml(nws) {
  // i18n-ignore: the Local panel is English-only county content.
  const head = '<h3 class="gev-local-section-head">Official NWS alerts</h3>';
  if (nws.error) return `${head}${errorHtml('NWS alerts', nws.error)}`;
  const env = nws.env;
  const items = Array.isArray(env.features) ? env.features : [];
  return `${head}${metaLine(env)}<div class="gev-local-chiprow">${layerToggleHtml('nws-alerts', 'alert areas')}</div>${
    env.status === 'unavailable'
      ? '<div class="gev-local-empty gev-local-error">NWS alerts are unavailable right now. Check weather.gov/phi directly.</div>'
      : items.length
        ? `<ul class="gev-local-list">${items
            .map(
              (
                a,
                i,
              ) => `<li><button type="button" class="gev-local-item" style="--item-accent:${escapeHtml(a.color)}" data-act="alert" data-i="${i}">
                <span class="gev-local-row"><strong>${escapeHtml(a.title)}</strong>${a.severity ? `<small>${escapeHtml(a.severity)}</small>` : ''}</span>
                <span>${escapeHtml(a.areaDesc || 'Area not stated')}</span>
                <small>Issued ${escapeHtml(easternTime(a.observedAt) || 'n/a')} · until ${escapeHtml(easternTime(a.expires) || 'not stated')}</small>
              </button></li>`,
            )
            .join('')}</ul>`
        : '<div class="gev-local-empty">No active NWS alerts for Cape May County, Delaware Bay or the nearby coastal waters.</div>'
  }`;
}

// ------------------------------------------------------------------ tabs
async function renderAlerts(body, token) {
  body.innerHTML = loadingHtml('live events and NWS alerts');
  // Read together; a failed events read never holds up the NWS list.
  const signal = newEventsSignal();
  const [events, nws] = await Promise.all([
    loadEvents({ signal }),
    fetchLocal('nws-alerts').then(
      (env) => ({ env }),
      (error) => ({ error }),
    ),
  ]);
  if (token !== renderToken) return;
  if (eventsAbort?.signal === signal) eventsAbort = null;
  takeEvents(events, { full: true });
  eventsRows = EVENTS_ROWS;
  // i18n-ignore: the Local panel is English-only county content.
  body.innerHTML = `<section class="gev-events-live" aria-label="Live events">
      <h3 class="gev-local-section-head">Live events</h3>
      <div data-part="events-meta"></div>
      <div data-part="crawl"></div>
      <div data-part="timeline"></div>
    </section>
    <section class="gev-local-nws" aria-label="NWS alerts">${nwsHtml(nws)}</section>`;
  paintEvents(body);
  body.onclick = (e) => {
    const event = e.target.closest('[data-act="event"]');
    if (event) {
      activateEvent(event.dataset.id);
      return;
    }
    if (e.target.closest('[data-act="events-more"]')) {
      eventsRows += EVENTS_ROWS_STEP;
      paintEvents(body);
      return;
    }
    if (e.target.closest('[data-act="retry"]')) {
      show('alerts');
      return;
    }
    const el = e.target.closest('[data-act="alert"]');
    const items = nws.env?.features;
    if (el && Array.isArray(items) && items[+el.dataset.i])
      openRecord({
        ...DEF['nws-alerts'].toRecord(items[+el.dataset.i], nws.env),
        fetchedAt: nws.env.fetchedAt,
      });
  };
  alertsDrawnToken = token;
  settlePendingEvent(body);
  // The shared poller's next read is 30 s after this full one.
  scheduleEventsRefresh();
}

async function renderCalls(body, token) {
  body.innerHTML = loadingHtml('recent calls');
  const [atc, ps] = await Promise.all([
    fetchLocal('airport-radio').catch((e) => ({
      status: 'unavailable',
      note: e.message,
      features: [],
      source: { name: 'Airport radio' },
    })),
    fetchLocal('public-safety-calls').catch((e) => ({
      status: 'unavailable',
      note: e.message,
      features: [],
      source: { name: 'Fire Wire scanner' },
    })),
  ]);
  if (token !== renderToken) return;
  const rows = [
    ...ps.features.map((f) => ({ f, env: ps, kind: 'ps' })),
    ...atc.features.map((f) => ({ f, env: atc, kind: 'atc' })),
  ]
    .filter((r) => callFilter === 'all' || r.kind === callFilter)
    .sort((a, b) =>
      String(b.f.observedAt).localeCompare(String(a.f.observedAt)),
    );
  const chipBtn = (id, label) =>
    `<button type="button" class="gev-local-btn${callFilter === id ? ' is-active' : ''}" data-act="filter" data-filter="${id}" aria-pressed="${callFilter === id}">${label}</button>`;
  body.innerHTML = `
    <div class="gev-local-chiprow">${chipBtn('all', 'All')}${chipBtn('ps', 'Police · Fire · EMS')}${chipBtn('atc', 'Airport radio')}</div>
    ${tabTogglesHtml('calls')}
    <div class="gev-local-meta">${badge(ps.status)}<span>Police/Fire/EMS: ${escapeHtml(ps.source?.name || '')} · ${ps.features.length} in 48 h</span></div>
    ${ps.note ? `<p class="gev-local-note">${escapeHtml(ps.note)}</p>` : ''}
    <div class="gev-local-meta">${badge(atc.status)}<span>Airport radio: ${escapeHtml(atc.source?.name || '')} · updated ${escapeHtml(atc.fetchedAt ? relativeTime(atc.fetchedAt) : 'never')}</span></div>
    ${atc.note ? `<p class="gev-local-note">${escapeHtml(atc.note)}</p>` : ''}
    ${
      rows.length
        ? `<ul class="gev-local-list">${rows
            .slice(0, 80)
            .map(
              (
                r,
                i,
              ) => `<li><button type="button" class="gev-local-item" style="--item-accent:${escapeHtml(r.f.color || '#4cc9f0')}" data-act="call" data-i="${i}">
              <span class="gev-local-row"><strong>${escapeHtml(r.f.title)}</strong>${badge('transcribed')}${r.f.audio ? '<small>▶ audio</small>' : ''}</span>
              <span>${escapeHtml((r.kind === 'atc' ? r.f.transcript : r.f.summary || r.f.location) || 'No transcript')}</span>
              <small>${escapeHtml(whenText(r.f.observedAt) || 'time unknown')}</small>
            </button></li>`,
            )
            .join('')}</ul>`
        : '<div class="gev-local-empty">No calls to show for this filter.</div>'
    }`;
  body.onclick = (e) => {
    const filter = e.target.closest('[data-act="filter"]');
    if (filter) {
      callFilter = filter.dataset.filter;
      return show('calls');
    }
    const el = e.target.closest('[data-act="call"]');
    if (!el) return;
    const r = rows[+el.dataset.i];
    const record =
      r.kind === 'atc' ? atcRecord(r.f, r.env) : callRecord(r.f, r.env);
    openRecord({
      ...record,
      fetchedAt: r.env.fetchedAt,
      lat: r.f.geometry?.lat,
      lon: r.f.geometry?.lon,
      flyHeight: 9000,
    });
  };
}

function card(title, m, inner) {
  return `<article class="gev-local-card"><h3><span>${escapeHtml(title)}</span>${badge(m.status)}</h3>${inner}<footer>${escapeHtml(m.source || 'unknown source')} · updated ${escapeHtml(m.updatedAgo || 'never')}${m.note ? ` · ${escapeHtml(m.note)}` : ''}</footer></article>`;
}

const BARRIER_CAUSEWAYS = Object.freeze([
  {
    island: 'Wildwood / Five Mile Beach',
    elevatedRoute: 'NJ-147 (N Wildwood Blvd Viaduct) → GSP Exit 6',
    lowChokepoint: 'NJ-47 / Rio Grande Ave marsh (< 5.2 ft NAVD88)',
    lat: 39.0185,
    lon: -74.821,
  },
  {
    island: 'West Wildwood',
    elevatedRoute: 'Glenwood Ave Bridge (solitary bridge — evacuate early)',
    lowChokepoint: 'Bridge approaches submerge at ≥ 6.0 ft MLLW',
    lat: 39.0021,
    lon: -74.8264,
  },
  {
    island: 'Ocean City',
    elevatedRoute: 'NJ-52 (9th St Causeway 100-Yr Viaduct) → Somers Point',
    lowChokepoint: "34th St & Corson's Inlet marsh approaches",
    lat: 39.2865,
    lon: -74.5942,
  },
  {
    island: 'Sea Isle City',
    elevatedRoute: 'Sea Isle Blvd (raised CR-625) → GSP Exit 17',
    lowChokepoint: 'Landis Ave flood zones (38th–85th St)',
    lat: 39.158,
    lon: -74.712,
  },
  {
    island: 'Seven Mile Island (Avalon / Stone Harbor)',
    elevatedRoute: 'Avalon Blvd (CR-601) → GSP Exit 13',
    lowChokepoint: 'Stone Harbor Blvd (CR-657) low marsh approaches',
    lat: 39.1045,
    lon: -74.739,
  },
  {
    island: 'Cape May / W Cape May / Cape May Point',
    elevatedRoute: 'NJ-109 High-Level Canal Bridge → GSP Exit 0',
    lowChokepoint: 'Sunset Blvd low marsh washouts',
    lat: 38.9615,
    lon: -74.9125,
  },
]);

function causewaysCardHtml(c) {
  const flooding = c?.floodGauges?.atOrAboveFloodStage || [];
  const hasFlood = flooding.length > 0;
  const rows = BARRIER_CAUSEWAYS.map(
    (cw) =>
      `<li><strong>${escapeHtml(cw.island)}</strong>: use <strong>${escapeHtml(cw.elevatedRoute)}</strong> · avoids ${escapeHtml(cw.lowChokepoint)} <button type="button" class="gev-local-btn is-quiet" data-act="causeway" data-lat="${cw.lat}" data-lon="${cw.lon}" style="margin-left:4px;padding:1px 6px;font-size:11px">Fly to</button></li>`,
  ).join('');
  return card(
    'Barrier island causeways & flood bypasses',
    {
      status: hasFlood ? 'forecast' : 'reference',
      source: 'Cape May County elevation corridors + NOAA gauges',
      updatedAgo: c?.floodGauges?.updatedAgo || 'live',
    },
    `<p>${hasFlood ? `<strong>Active flood stage watch (${escapeHtml(flooding.map((g) => g.gauge).join(', '))}):</strong> prefer elevated viaduct causeways below.` : 'No gauges at or above flood stage right now.'}</p><details class="gev-local-fold"${hasFlood ? ' open' : ''}><summary style="cursor:pointer;font-size:12px;margin:4px 0">${hasFlood ? 'Elevated storm-hardened corridors for each barrier island' : 'Show 6 barrier island causeway bypass corridors & Fly-to pins'}</summary><ul>${rows}</ul></details>`,
  );
}

/** The County tab's conditions cards (/api/local/conditions). */
function conditionsHtml(c) {
  const town = getMyTown();
  const li = (items) =>
    `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const tides = c.floodGauges.tideStations.map((t) => {
    const upcoming = (t.nextTides || [])
      .slice(0, 2)
      .map(
        (p) =>
          `${p.type} ${p.ft} ft at ${escapeHtml(easternTime(p.time, { date: false }))}`,
      )
      .join(', ');
    return `${escapeHtml(t.station)}: ${t.observedFtMLLW != null ? `<strong>${t.observedFtMLLW} ft</strong> observed` : 'no current observation from NOAA'}${upcoming ? ` · next ${upcoming} (predicted)` : ''}`;
  });
  const hasPredictedFlood = (c.predictedFlooding?.anchors || []).length > 0;
  const predictedCard = card(
    'Predicted flooding (estimate)',
    {
      status: c.predictedFlooding.status,
      source: c.predictedFlooding.source,
      updatedAgo: c.floodGauges.updatedAgo,
    },
    `<p>${escapeHtml(hasPredictedFlood ? c.predictedFlooding.anchors.map((a) => `~${a.levelFt} ft above normal high tide near ${a.gauge}`).join('; ') : c.predictedFlooding.note)}</p>`,
  );
  const radarCard = card(
    'Rain radar',
    {
      status: 'reference',
      source: 'NOAA MRMS (map layer)',
      updatedAgo: 'see layer',
    },
    `<p>${escapeHtml(c.radar.note)}</p>`,
  );
  return `
    <p class="gev-local-note">${escapeHtml(c.disclaimer)}</p>
    ${town.name ? `<div class="gev-local-meta"><span>My Town: ${escapeHtml(town.name)}</span></div>` : ''}
    <div class="gev-local-cards">
      ${card('NWS alerts', c.alerts, c.alerts.active.length ? li(c.alerts.active.map((a) => `<strong>${escapeHtml(a.event)}</strong> — until ${escapeHtml(easternTime(a.expires) || 'n/a')}`)) : '<p>No active alerts.</p>')}
      ${card('Tides & flood gauges', c.floodGauges, `<p>${c.floodGauges.reporting ?? '?'} gauges reporting. ${c.floodGauges.atOrAboveFloodStage.length ? `<strong>At or forecast above flood stage:</strong> ${c.floodGauges.atOrAboveFloodStage.map((g) => `${escapeHtml(g.gauge)} (${escapeHtml(g.category)}, ${g.observedNow ? 'observed now' : 'forecast'})`).join('; ')}` : 'None at or forecast above flood stage.'}</p>${li(tides)}`)}
      ${hasPredictedFlood ? predictedCard : ''}
      ${causewaysCardHtml(c)}
      ${card('Power outages', c.powerOutages, c.powerOutages.byCounty.length ? li(c.powerOutages.byCounty.map((k) => `${escapeHtml(k.county)}: <strong>${Number(k.out).toLocaleString('en-US')}</strong> customers out of ${Number(k.served || 0).toLocaleString('en-US')}`)) : '<p>No outage data.</p>')}
      ${card('Traffic incidents', c.trafficIncidents, `<p><strong>${c.trafficIncidents.count}</strong> crashes, closures and road works reported across Cape May, Atlantic and Cumberland counties.</p>`)}
      ${card(
        'Marine',
        c.marine,
        `${li(c.marine.stations.map((s) => `${escapeHtml(s.station)}: ${s.status === 'observed' ? `waves ${s.waveHeightFt ?? 'n/a'} ft · water ${s.waterTempF ?? 'n/a'}°F · wind ${s.windKt ?? 'n/a'} kt` : 'not reporting'}`))}${
          c.marine.aisVessels?.countInBayAndCoast
            ? `<p style="margin-top:6px"><strong>Live AIS in Delaware Bay &amp; Cape May coast:</strong> ${c.marine.aisVessels.countInBayAndCoast} vessels tracked${
                c.marine.aisVessels.notable?.length
                  ? ` (${c.marine.aisVessels.notable
                      .slice(0, 4)
                      .map(
                        (v) =>
                          `${escapeHtml(v.name)}${v.role !== 'vessel' ? ` [${escapeHtml(v.role.toUpperCase())}]` : ''}${v.speedKt != null ? ` ${v.speedKt} kt` : ''}`,
                      )
                      .join(', ')})`
                  : ''
              }</p>`
            : ''
        }`,
      )}
      ${card('Airport weather', c.airports, li(c.airports.local.map((a) => `${escapeHtml(a.airport)}: ${escapeHtml(a.category || 'n/a')} · wind ${a.windKt ?? 'n/a'}${a.gustKt ? `G${a.gustKt}` : ''} kt · ${a.tempF ?? 'n/a'}°F`)))}
      <details class="gev-local-fold"><summary style="cursor:pointer;font-size:12px;opacity:0.85;margin:4px 0">Reference notes (${hasPredictedFlood ? 'rain radar' : 'predicted flooding estimate & rain radar'})</summary>${hasPredictedFlood ? '' : predictedCard}${radarCard}</details>
    </div>
    <div class="gev-local-chiprow" style="margin-top:10px">${['nws-alerts', 'tide-gauges', 'power-outages', 'traffic-incidents', 'emergency-facilities', 'marine-buoys', 'airport-weather'].map((id) => layerToggleHtml(id, DEF[id].name)).join('')}</div>`;
}

async function renderCounty(body, token) {
  body.innerHTML = loadingHtml('the county dashboard');
  // Read together: one failing never blanks the other.
  const [items, conditions] = await Promise.all([
    loadDashboard().catch(() => null),
    fetchLocal('conditions').then(
      (c) => ({ c }),
      (error) => ({ error }),
    ),
  ]);
  if (token !== renderToken) return;
  // i18n-ignore: the Local panel is English-only county content.
  body.innerHTML = `
    <h3 class="gev-local-section-head">County dashboard</h3>
    ${
      items
        ? dashboardHtml(items, {
            toggle: (id, title) => layerToggleHtml(id, title, { short: true }),
          })
        : '<div class="gev-local-empty gev-local-error">The county dashboard could not load. Try again in a few minutes.</div>'
    }
    <span class="gev-local-label gev-local-planning-label">Planning</span>
    ${tabTogglesHtml('county', 'gev-local-planning')}
    <h3 class="gev-local-section-head">County conditions</h3>
    ${conditions.error ? errorHtml('county conditions', conditions.error) : conditionsHtml(conditions.c)}`;
  body.onclick = (e) => {
    if (e.target.closest('[data-act="retry"]')) return show('county');
    const cw = e.target.closest('[data-act="causeway"]');
    if (cw) {
      flyTo(Number(cw.dataset.lat), Number(cw.dataset.lon), 4500);
      if (isPhone()) closeLocalPanel();
    }
  };
}

function newsHtml(env) {
  const features = Array.isArray(env.features) ? env.features : [];
  return `${metaLine(env)}${
    features.length
      ? `<ul class="gev-local-list">${features
          .map(
            (
              n,
            ) => `<li><a class="gev-local-item" href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(n.title)}</strong>
              <small>${escapeHtml(n.publisher)} (${escapeHtml(n.publisherKind)}) · ${escapeHtml(whenText(n.observedAt) || 'date unknown')} ↗</small>
            </a></li>`,
          )
          .join('')}</ul>`
      : '<div class="gev-local-empty">No local headlines in the last 14 days.</div>'
  }<p class="gev-local-note" style="margin-top:10px">Headlines link to the publisher. News reports are not verified by this app.</p>`;
}

async function renderNews(body, token) {
  body.innerHTML = loadingHtml('local news');
  const news = await fetchLocal('local-news').then(
    (env) => ({ env }),
    (error) => ({ error }),
  );
  if (token !== renderToken) return;
  // The briefing switches stay usable when the headlines fail to load.
  body.innerHTML = `${tabTogglesHtml('news')}${
    news.error ? errorHtml('local news', news.error) : newsHtml(news.env)
  }`;
  body.onclick = (e) => {
    if (e.target.closest('[data-act="retry"]')) show('news');
  };
}

function renderTown(body) {
  const town = getMyTown();
  body.innerHTML = `
    <p>${town.name ? `Your town is <strong>${escapeHtml(town.name)}</strong>${town.source === 'near-me' ? ' (nearest town to your location)' : ''}.` : 'Pick your town to focus the map and lists. It is saved on this device only.'}</p>
    <div class="gev-local-chiprow">
      <button type="button" class="gev-local-btn" data-act="near">📍 Near me</button>
      ${town.name ? '<button type="button" class="gev-local-btn is-quiet" data-act="clear">Clear my town</button>' : ''}
    </div>
    <p class="gev-local-status" role="status" aria-live="polite"></p>
    <div class="gev-local-chiprow">${townChoices()
      .map(
        (t) =>
          `<button type="button" class="gev-local-btn${town.name === t.name ? ' is-active' : ''}" data-act="pick" data-town="${escapeHtml(t.id)}" aria-pressed="${town.name === t.name}">${escapeHtml(t.name)}</button>`,
      )
      .join('')}</div>
    ${
      town.name
        ? `<div class="gev-local-form">
        <label class="gev-local-check"><input type="checkbox" data-act="filter" ${town.filterMap ? 'checked' : ''} /> <span>Only show map items within the radius of my town (gauges, outages, incidents, facilities, buoys, airports, calls). Official NWS alerts are always shown.</span></label>
        <label>Radius <select data-act="radius">${[5, 8, 12, 20, 30].map((km) => `<option value="${km}" ${town.radiusKm === km ? 'selected' : ''}>${km} km (${Math.round(km * 0.621)} mi)</option>`).join('')}</select></label>
      </div>`
        : ''
    }
    <p class="gev-local-note" style="margin-top:12px">“Near me” asks your browser for your location once, uses it to pick the nearest town, and does not store or send your exact position.</p>`;
  const status = body.querySelector('.gev-local-status');
  body.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'pick') {
      const t = townChoices().find((x) => x.id === el.dataset.town);
      setMyTown(t);
      flyTo(t.lat, t.lon, 9000);
      renderTown(body);
    } else if (el.dataset.act === 'clear') {
      clearMyTown();
      renderTown(body);
    } else if (el.dataset.act === 'near') {
      // i18n-ignore: the Local panel is English-only county content.
      status.textContent = 'Asking your browser for your location…';
      try {
        const t = await locateNearMe();
        setMyTown(t, 'near-me');
        flyTo(t.lat, t.lon, 9000);
        renderTown(body);
      } catch (error) {
        status.textContent = error.message;
      }
    }
  };
  body.onchange = (e) => {
    if (e.target.dataset.act === 'filter')
      setMyTownOptions({ filterMap: e.target.checked });
    if (e.target.dataset.act === 'radius')
      setMyTownOptions({ radiusKm: Number(e.target.value) });
  };
}

function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      // Re-encoding through a canvas also drops EXIF (including GPS) data.
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}

function mapCenter() {
  const canvas = viewer?.scene?.canvas;
  if (!canvas) return null;
  const ray = viewer.camera.getPickRay(
    new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
  );
  const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
  const carto = hit
    ? Cesium.Cartographic.fromCartesian(hit)
    : viewer.camera.positionCartographic;
  return carto
    ? {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
      }
    : null;
}

async function renderReport(body) {
  const town = getMyTown();
  const config = await fetch('/api/local/report-config')
    .then((r) => r.json())
    .catch(() => ({}));
  // i18n-ignore: the Local panel is English-only county content.
  body.innerHTML = `
    <form class="gev-local-form" novalidate>
      <p class="gev-local-note"><strong>For emergencies call 911.</strong> This form does not reach dispatchers. Reports are saved <strong>privately</strong>, are <strong>not public</strong> until reviewed, and are never shown as confirmed facts.</p>
      <label>What are you seeing?
        <select name="category">
          <option value="flooding">Flooding / water on roads</option>
          <option value="road-hazard">Road hazard (tree, wires, debris)</option>
          <option value="power-out">Power out</option>
          <option value="storm-damage">Storm damage</option>
          <option value="fire-smoke">Fire or smoke</option>
          <option value="traffic">Traffic / crash</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label>Describe it (no names, phone numbers or other personal details)
        <textarea name="text" maxlength="1000" required placeholder="e.g. Water covering both lanes of Route 47 near Dennisville"></textarea>
      </label>
      <label>Town (optional)
        <select name="town"><option value="">Not given</option>${townChoices()
          .map(
            (t) =>
              `<option ${town.name === t.name ? 'selected' : ''}>${escapeHtml(t.name)}</option>`,
          )
          .join('')}</select>
      </label>
      <label class="gev-local-check"><input type="checkbox" name="useCenter" /> <span>Attach the approximate spot at the center of the map (rounded to about 100 m). Your device location is not used.</span></label>
      <label>Photo (optional — resized on your device; location data inside the photo is removed)
        <input type="file" name="photo" accept="image/*" />
      </label>
      ${config.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(config.turnstileSiteKey)}"></div>` : ''}
      <label class="gev-hp">Leave this blank<input type="text" name="gev_hp" tabindex="-1" autocomplete="off" /></label>
      <button type="submit" class="gev-local-btn">Send report for review</button>
      <p class="gev-local-status" role="status" aria-live="polite"></p>
    </form>`;
  if (
    config.turnstileSiteKey &&
    !document.querySelector('script[data-turnstile]')
  ) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.dataset.turnstile = '1';
    document.head.appendChild(script);
  }
  const form = body.querySelector('form');
  const status = body.querySelector('.gev-local-status');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const text = String(data.get('text') || '').trim();
    if (text.length < 5) {
      // i18n-ignore: the Local panel is English-only county content.
      status.textContent = 'Please describe what you are seeing.';
      return;
    }
    const payload = {
      category: data.get('category'),
      text,
      town: data.get('town') || null,
      gev_hp: data.get('gev_hp') || '',
      turnstileToken:
        form.querySelector('[name="cf-turnstile-response"]')?.value || '',
    };
    if (data.get('useCenter')) Object.assign(payload, mapCenter() || {});
    const file = data.get('photo');
    form.querySelector('[type=submit]').disabled = true;
    // i18n-ignore: the Local panel is English-only county content.
    status.textContent = 'Sending…';
    try {
      if (file && file.size) payload.photo = await shrinkPhoto(file);
      const r = await fetch('/api/local/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      form.reset();
      status.textContent = j.message;
    } catch (error) {
      // i18n-ignore: the Local panel is English-only county content.
      status.textContent = `Could not send: ${error.message}`;
    } finally {
      form.querySelector('[type=submit]').disabled = false;
    }
  };
}

async function renderReplay(body, token) {
  body.innerHTML = loadingHtml('recorded radio');
  // A failed read shows as unavailable, so the history switch stays usable.
  const env = await fetchLocal('airport-radio').catch((e) => ({
    status: 'unavailable',
    note: e.message,
    features: [],
    source: { name: 'Airport radio' },
  }));
  if (token !== renderToken) return;
  const clips = (Array.isArray(env.features) ? env.features : [])
    .filter((f) => f.audio)
    .sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)));
  body.innerHTML = `${metaLine(env)}
    <p>Replay the most recent recorded Atlantic City tower radio in order (${clips.length} clips${clips.length ? `, ${escapeHtml(easternTime(clips[0].observedAt) || '')} to ${escapeHtml(easternTime(clips[clips.length - 1].observedAt, { date: false }) || '')}` : ''}).</p>
    <div class="gev-local-chiprow">
      <button type="button" class="gev-local-btn" data-act="play" ${clips.length ? '' : 'disabled'}>▶ Play in order</button>
      <button type="button" class="gev-local-btn is-quiet" data-act="stop">■ Stop</button>
    </div>
    <div class="gev-local-transcript"><span class="gev-local-label">Now playing</span><blockquote class="gev-replay-now">Nothing playing.</blockquote><small>Automatic transcripts may contain errors.</small></div>
    <p class="gev-local-note" style="margin-top:12px">Map layers with history (transit, weather radar, satellites) replay with the timeline bar at the bottom of the map. Police/fire/EMS call replay is unavailable while that scanner feed is offline.</p>
    ${clips.length ? '' : '<div class="gev-local-empty">No recorded clips available.</div>'}
    <h3 class="gev-local-section-head">History replay</h3>
    <p class="gev-local-hint">Puts this site's own recorded aircraft positions and feed items back on the map, an hour at a time.</p>
    ${tabTogglesHtml('replay')}`;
  const now = body.querySelector('.gev-replay-now');
  const stop = () => {
    replay.audio?.pause();
    replay = { audio: null, queue: [], index: -1 };
  };
  const next = () => {
    replay.index += 1;
    const clip = replay.queue[replay.index];
    if (!clip) {
      // i18n-ignore: the Local panel is English-only county content.
      now.textContent = 'Replay finished.';
      return stop();
    }
    now.textContent = `${easternTime(clip.observedAt) || ''} — ${clip.transcript || 'No transcript'}`;
    replay.audio = new Audio(clip.audio);
    replay.audio.onended = next;
    replay.audio.onerror = next;
    replay.audio.play().catch(() => {
      now.textContent =
        // i18n-ignore: the Local panel is English-only county content.
        'Your browser blocked audio playback. Press Play again.';
      stop();
    });
  };
  body.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') {
      stop();
      replay.queue = clips;
      next();
    } else if (act === 'stop') {
      stop();
      // i18n-ignore: the Local panel is English-only county content.
      now.textContent = 'Stopped.';
    }
  };
}

const RENDERERS = {
  alerts: renderAlerts,
  calls: renderCalls,
  county: renderCounty,
  news: renderNews,
  town: renderTown,
  report: renderReport,
  replay: renderReplay,
};
const TAB_LABEL = Object.fromEntries(TABS);

function flyTo(lat, lon, height) {
  viewer?.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(normalizePitchDeg(-90)),
      roll: 0,
    },
    duration: 1.8,
  });
}

async function show(tab) {
  activeTab = RENDERERS[tab] ? tab : 'alerts';
  const token = ++renderToken;
  // A new draw of any tab ends the Alerts tab's share of the events poller
  // (renderAlerts starts it again); the HUD keeps it if the HUD shows.
  syncEventsPoller();
  replay.audio?.pause();
  panel.querySelector('.gev-local-tabs').innerHTML = TABS.map(
    ([id, label]) =>
      `<button type="button" role="tab" class="gev-local-btn${id === activeTab ? ' is-active' : ''}" aria-selected="${id === activeTab}" data-tab="${id}">${label}</button>`,
  ).join('');
  const body = panel.querySelector('.gev-local-body');
  body.onclick = null;
  body.onchange = null;
  try {
    await RENDERERS[activeTab](body, token);
  } catch (error) {
    if (token !== renderToken) return;
    body.innerHTML = errorHtml(TAB_LABEL[activeTab], error);
    body.onclick = (e) => {
      if (e.target.closest('[data-act="retry"]')) show(activeTab);
    };
    return;
  }
}

/**
 * Open the panel on a tab. The HUD is the panel shrunk: opening the panel
 * while the HUD is open expands it, in the mode the panel was in before,
 * and closing the panel brings the HUD back (`from` is the HUD control that
 * asked, focused again then).
 * @param {string} [tab]
 * @param {{from?: {hud: string, id?: string}|null}} [options]
 */
export function openLocalPanel(tab, { from = null } = {}) {
  if (!panel) return;
  if (hud?.isOpen()) {
    if (panel.hidden || !hudReturn) hudReturn = from ?? { hud: 'grip' };
    hud.hide();
  }
  windowCtl?.leaveHud();
  panel.hidden = false;
  windowCtl?.apply();
  show(tab || activeTab);
  panel.querySelector('.gev-local-close')?.focus();
}

/** Focus the first of these that takes it; false when none does. */
function focusFirst(...elements) {
  for (const element of elements) {
    if (!element || element.hidden) continue;
    element.focus?.({ preventScroll: true });
    if (document.activeElement === element) return true;
  }
  return false;
}

/**
 * Close the panel (×, Escape, the Local button). Opened from the HUD, it
 * shrinks back into the HUD. A keyboard user inside the panel is taken to
 * the HUD control that opened it, else to the Local button, never dropped
 * at the top of the page.
 * @param {{returnToHud?: boolean}} [options]
 */
export function closeLocalPanel({ returnToHud = true } = {}) {
  if (!panel) return;
  // A corner resize still settling is kept, not lost with the panel.
  windowCtl?.flush();
  const active = document.activeElement;
  const hadFocus =
    panel.contains(active) || !active || active === document.body;
  const back = returnToHud ? hudReturn : null;
  hudReturn = null;
  replay.audio?.pause();
  panel.hidden = true;
  // A closed panel reads nothing: a draw still loading is dropped (opening
  // draws the tab again) and the events refresh stops unless the HUD shows.
  renderToken += 1;
  // Whatever the Alerts tab had in flight goes with it; the HUD branch and
  // the plain close below each start the poller again if it is still wanted.
  stopEventsRefresh();
  if (back && hud && windowCtl) {
    windowCtl.setMode('hud');
    showHud();
    if (back.hud === 'more' && back.id) hud.expand(back.id);
    if (hadFocus) hud.focusControl(back);
    return;
  }
  syncEventsPoller();
  if (hadFocus && panel.contains(active))
    focusFirst(document.getElementById('local-panel-btn'));
}

/** Show the HUD with what is loaded; read at once when that is stale. */
function showHud({ focus = false } = {}) {
  if (!hud) return;
  hud.show(liveEvents);
  syncEventsPoller({ now: eventsStale() });
  if (focus) hud.focus();
}

/** "Shrink to HUD": the panel closes into the events HUD. */
function shrinkToHud() {
  if (!panel || !hud || !windowCtl) return;
  windowCtl.setMode('hud');
  closeLocalPanel({ returnToHud: false });
  showHud({ focus: true });
}

/** × on the HUD: it closes; the Local button opens the panel again. */
function closeHud() {
  if (!hud) return;
  const hadFocus = hud.el.contains(document.activeElement);
  hud.hide();
  hudReturn = null;
  windowCtl?.leaveHud();
  syncEventsPoller();
  if (hadFocus) focusFirst(document.getElementById('local-panel-btn'));
}

export function toggleLocalPanel() {
  if (!panel) return;
  if (panel.hidden) openLocalPanel();
  else closeLocalPanel();
}

async function refreshChip() {
  try {
    const env = await fetchLocal('nws-alerts');
    const top = env.features[0];
    if (!top || env.status === 'unavailable' || chipDismissedFor === top.id) {
      chip.hidden = true;
      return;
    }
    const more = env.features.length - 1;
    chip.style.setProperty('--chip-color', top.color);
    chip.innerHTML = `<span class="gev-local-chip-dot" aria-hidden="true"></span>
      <button type="button" class="gev-local-chip-main" data-act="open" title="Open NWS alerts">NWS · ${escapeHtml(top.title)}${top.expires ? ` until ${escapeHtml(easternTime(top.expires, { date: false }))}` : ''}${more > 0 ? ` · +${more} more` : ''}${env.status === 'delayed' ? ' · DELAYED' : ''}</button>
      <button type="button" data-act="dismiss" aria-label="Hide this alert banner">×</button>`;
    chip.dataset.top = top.id;
    chip.hidden = false;
  } catch {
    chip.hidden = true;
  }
}

/**
 * Mount the local shell.
 * @param {{viewer: Cesium.Viewer, dataManager: object}} options
 * @returns {() => void} destroy
 */
export function initLocalShell({ viewer: v, dataManager: dm }) {
  viewer = v;
  dataManager = dm;
  const destroyDetails = initDetailsPanel({ viewer });

  panel = document.createElement('section');
  panel.id = 'gev-local-main';
  panel.className = 'gev-local-panel';
  panel.setAttribute('role', 'dialog');
  // i18n-ignore: the Local panel is English-only county content.
  panel.setAttribute('aria-label', 'Local conditions');
  panel.hidden = true;
  // i18n-ignore: the Local panel is English-only county content.
  panel.innerHTML = `
    <header class="gev-local-head">
      <div class="gev-local-title">${windowGripHtml()}<div class="gev-local-title-text"><span class="gev-local-kicker">Cape May County · South Jersey</span><h2>Local conditions</h2></div></div>
      <div class="gev-local-chiprow" style="align-items:center;margin:0">
        <span id="gev-local-auth-links" style="display:inline-flex;gap:6px;align-items:center">
          <a class="gev-local-btn is-quiet" href="${escapeHtml(signInHref(window.location))}" style="text-decoration:none">Sign In</a>
        </span>
        <a class="gev-local-btn is-quiet" href="/guide" style="text-decoration:none">Guide</a>
        <a class="gev-local-btn is-quiet" href="/support" style="text-decoration:none">Support</a>
        <a class="gev-local-btn is-quiet" href="/privacy" style="text-decoration:none">Privacy</a>
        ${windowControlsHtml()}
        <button type="button" class="gev-local-close" aria-label="Close local conditions">×</button>
      </div>
    </header>
    <div class="gev-local-tabs" role="tablist" aria-label="Local sections"></div>
    <div class="gev-local-body ui-scroll" role="tabpanel"></div>`;
  document.body.appendChild(panel);
  panel.querySelector('.gev-local-close').onclick = () => closeLocalPanel();
  // Move, resize and dock the panel, or shrink it to the events HUD.
  windowCtl = createPanelWindow({
    panel,
    header: panel.querySelector('.gev-local-head'),
    handle: panel.querySelector('.gev-win-grip'),
    isPhone,
    onShrink: shrinkToHud,
  });
  hud = createEventHud({
    position: windowCtl.layout.hud,
    isPhone,
    onFly: (id) => activateEvent(id, { closeOnPhone: false }),
    onMore: (id) => {
      pendingEvent = { id, activate: false };
      openLocalPanel('alerts', { from: { hud: 'more', id } });
    },
    onOpen: () => openLocalPanel('alerts', { from: { hud: 'open' } }),
    onClose: closeHud,
    onMove: (position) => windowCtl?.setHudPosition(position),
    // Clean view, the cockpit or a phone sheet hid it (its reads stop) or
    // showed it again (it shows what is loaded, and reads if that is stale).
    onShownChange: (shown) => {
      if (shown) hud?.update(hudLive());
      syncEventsPoller({ now: shown && eventsStale() });
    },
  });
  document.addEventListener('visibilitychange', onPageVisibility);
  panel.querySelector('.gev-local-tabs').onclick = (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) show(tab);
  };
  // "Show on map" toggles inside any tab.
  panel.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act="layer"]');
    if (!el) return;
    const id = el.dataset.layer;
    try {
      await setLayer(id, !layerOn(id));
    } catch {
      /* the switch shows whatever the layer ended up as */
    }
    // Each switch keeps its own wording (data-label), dashboard cards too.
    syncLayerButtons();
  });
  const onKey = (e) => {
    if (
      e.key === 'Escape' &&
      !panel.hidden &&
      document.getElementById('gev-local-details')?.hidden !== false
    )
      closeLocalPanel();
  };
  document.addEventListener('keydown', onKey);

  chip = document.createElement('div');
  chip.id = 'gev-local-alert-chip';
  chip.setAttribute('role', 'status');
  chip.hidden = true;
  document.body.appendChild(chip);
  chip.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'open') openLocalPanel('alerts');
    if (act === 'dismiss') {
      chipDismissedFor = chip.dataset.top;
      chip.hidden = true;
    }
  };
  refreshChip();
  chipTimer = setInterval(refreshChip, 120000);

  // Sync runtime manager config, auth bar, layer defaults, and ?lat=&lon= deep link
  fetch('/api/local/app-config', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg) return;
      appConfig = cfg;
      applyAiChatVisibility(cfg.aiChatEnabled !== false);
      const authLinks = panel?.querySelector('#gev-local-auth-links');
      if (authLinks) {
        if (cfg.auth?.authenticated && cfg.auth?.user) {
          const u = cfg.auth.user;
          authLinks.innerHTML = `
            <a class="gev-local-btn is-quiet" href="/account" style="text-decoration:none">👤 ${escapeHtml(u.displayName || u.username)}</a>
            ${u.isAdmin ? '<a class="gev-local-btn is-active" href="/manager" style="text-decoration:none">🛡️ Manager</a>' : ''}
          `;
        } else {
          authLinks.innerHTML =
            // i18n-ignore: the Local panel is English-only county content.
            `<a class="gev-local-btn is-quiet" href="${escapeHtml(signInHref(window.location))}" style="text-decoration:none">Sign In</a>`;
        }
      }
      if (cfg.layers && typeof cfg.layers === 'object') {
        for (const [layerId, lcfg] of Object.entries(cfg.layers)) {
          if (!lcfg || typeof lcfg !== 'object') continue;
          if (lcfg.hidden) {
            setLayer(layerId, false);
          } else if (typeof lcfg.enabledByDefault === 'boolean') {
            setLayer(layerId, lcfg.enabledByDefault);
          }
        }
      }
      if (cfg.settings?.defaultTown && !getMyTown()?.name) {
        const match = townChoices().find(
          (t) =>
            t.id === cfg.settings.defaultTown.toLowerCase() ||
            t.name.toLowerCase() === cfg.settings.defaultTown.toLowerCase(),
        );
        if (match) setMyTown(match);
      }
      if (cfg.settings?.bannerText && chip && chip.hidden) {
        const toneColor =
          cfg.settings.bannerSeverity === 'danger'
            ? '#ff4d4f'
            : cfg.settings.bannerSeverity === 'warn'
              ? '#ffb020'
              : '#38bdf8';
        chip.style.setProperty('--chip-color', toneColor);
        // i18n-ignore: the Local panel is English-only county content.
        chip.innerHTML = `<span class="gev-local-chip-dot" aria-hidden="true"></span>
          <button type="button" class="gev-local-chip-main" data-act="open">${escapeHtml(cfg.settings.bannerText)}</button>
          <button type="button" data-act="dismiss" aria-label="Hide this alert banner">×</button>`;
        chip.dataset.top = `mgr:${cfg.settings.bannerText}`;
        chip.hidden = false;
      }
    })
    .catch(() => {});

  // Fly to ?lat=...&lon=... when linked from /incidents/{id}.
  // A missing parameter is null, and Number(null) is 0, which used to fly
  // every clean load to null island at 3500 m and then write that hash.
  try {
    const target = incidentFlyTarget(window.location.search);
    if (target)
      setTimeout(() => flyTo(target.lat, target.lon, target.height), 900);
  } catch {
    /* ignore */
  }
  void isLayerHiddenByManager;
  const offTown = subscribeMyTown(() => {
    if (!panel.hidden && (activeTab === 'county' || activeTab === 'town'))
      show(activeTab);
  });
  // Used by nearMyTown-aware lists; referenced so bundlers keep the import.
  void nearMyTown;

  // The county ticker: tide, airport weather, the sea, power, NWS and gas at
  // a glance. GAS opens a card in the shared details window; LATEST opens
  // its event as if it were clicked in the Alerts tab.
  const destroyTicker = installCountyTicker({
    dataManager,
    openDetails: openRecord,
    openEvent: (eventId) => {
      openEventFromTicker(eventId).catch(() => {});
    },
  });
  // The ☰ menu: account, settings and the field guide.
  // Watched places: addresses with a radius, and push alerts near them.
  const watch = installWatchPanel();
  const destroyMenu = installAccountMenu({
    openLocal: openLocalPanel,
    openWatch: () => watch.open(),
  });
  // A rename from the menu shows on the Local panel's account button too.
  const onAccountUpdated = (event) => {
    const user = event?.detail?.user;
    const link = panel?.querySelector(
      '#gev-local-auth-links a[href="/account"]',
    );
    if (link && user)
      link.textContent = `👤 ${user.displayName || user.username || ''}`;
  };
  document.addEventListener('gev:account-updated', onAccountUpdated);

  // Left shrunk to the HUD last time: it is back on start.
  if (windowCtl.hudOpen) showHud();
  const watchdog = setInterval(eventsWatchdog, EVENTS_REFRESH_MS);

  return () => {
    clearInterval(watchdog);
    stopEventsRefresh();
    clearTimeout(highlightTimer);
    highlightTimer = null;
    hudReturn = null;
    eventsReadAt = 0;
    renderToken += 1;
    alertsDrawnToken = null;
    liveEvents = { data: null, error: null };
    eventsFailures = 0;
    selectedEventId = null;
    pendingEvent = null;
    document.removeEventListener('visibilitychange', onPageVisibility);
    hud?.destroy();
    windowCtl?.destroy();
    hud = windowCtl = null;
    document.removeEventListener('gev:account-updated', onAccountUpdated);
    destroyMenu();
    watch.dispose();
    destroyTicker();
    clearInterval(chipTimer);
    offTown();
    document.removeEventListener('keydown', onKey);
    destroyDetails();
    panel?.remove();
    chip?.remove();
    panel = chip = null;
  };
}
