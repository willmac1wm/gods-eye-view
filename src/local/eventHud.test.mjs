import '../testSupport/registerDom.mjs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUD_LINES,
  createEventHud,
  hudAnnouncement,
  hudLineHtml,
  hudStatus,
  hudSummaryHtml,
  worstSummaryLine,
} from './eventHud.js';

/*
 * The events HUD: what it draws from an /api/local/events answer, how a
 * line opens and folds, its callbacks, the unread count, reduced motion and
 * the live log that announces only new lines.
 */

const MIN = 60_000;
/** 6:46 PM Eastern on Thursday 19 November 2026. */
const NOW = Date.parse('2026-11-19T23:46:00Z');

function event(id, minutesAgo, extra = {}) {
  return {
    id,
    key: `key:${id}`,
    kind: 'call',
    change: 'new',
    title: `Event ${id}`,
    place: 'Rio Grande',
    detail: '',
    at: NOW - minutesAgo * MIN,
    seenAt: NOW - minutesAgo * MIN + 30_000,
    lat: 39.02,
    lon: -74.88,
    layer: 'scanner-calls',
    severity: 'info',
    source: 'Fire Wire scanner',
    threadId: id,
    related: [],
    ...extra,
  };
}

const fire = event('e-fire', 10, {
  title: 'Fire reported',
  detail: 'Structure fire · Middle Twp Fire',
  severity: 'warn',
  related: [{ id: 'e-road', reason: 'same road: Route 47' }],
});
const road = event('e-road', 20, {
  kind: 'traffic',
  title: 'Road closed',
  place: 'Route 47',
  severity: 'watch',
  source: '511NJ',
  layer: 'traffic-incidents',
  threadId: 'e-fire',
  related: [{ id: 'e-fire', reason: 'same road: Route 47' }],
});
const advisory = event('e-alert', 180, {
  kind: 'alert',
  title: 'Coastal Flood Advisory',
  place: 'Cape May County',
  lat: null,
  lon: null,
  layer: 'nws-alerts',
  severity: 'watch',
  source: 'NWS',
});
const hostile = event('e-xss', 240, {
  kind: 'report',
  title: '<img src=x onerror=alert(1)>',
  place: '"><script>alert(2)</script>',
  detail: '<b>bold</b>',
  source: '<i>Community</i>',
  lat: null,
  lon: null,
  layer: null,
});

function body(events = [fire, road, advisory, hostile], extra = {}) {
  return {
    generatedAt: NOW,
    summary: {
      at: NOW,
      lines: [
        {
          text: 'Coastal Flood Advisory until 10:00 PM',
          tone: 'watch',
          source: 'NWS',
        },
        {
          text: '1 open: fire in Rio Grande',
          tone: 'warn',
          source: 'Fire Wire scanner',
        },
        { text: 'Power: 12 customers out', tone: 'ok', source: 'ACE' },
      ],
    },
    sources: [
      { id: 'calls', name: 'Fire Wire scanner calls', ok: true },
      { id: 'aircraft', name: 'Coast Guard aircraft feed', ok: false },
    ],
    events,
    ...extra,
  };
}

const live = (data, error = null) => ({ data, error });

let hud;
let calls;
const realMatchMedia = window.matchMedia;

function mount(options = {}) {
  calls = [];
  hud = createEventHud({
    now: () => NOW,
    onFly: (id) => calls.push(['fly', id]),
    onMore: (id) => calls.push(['more', id]),
    onOpen: () => calls.push(['open']),
    onClose: () => calls.push(['close']),
    onMove: (position) => calls.push(['move', position]),
    ...options,
  });
  return hud;
}

const el = () => document.getElementById('gev-events-hud');
const lines = () => [...el().querySelectorAll('.gev-hud-lines > li')];
const announcer = () => el().querySelector('.gev-hud-announce');
/** A mouse event on the title strip; the button is held except on pointerup. */
const pointer = (type, x, y, extra = {}) =>
  new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 3,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
/** The HUD's box as a browser would report it. */
function setBox(box, { left, top, width, height }) {
  box.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
}
const lineOf = (id) => lines().find((li) => li.dataset.id === id);
const squash = (value) => value.replace(/\s+/g, ' ').trim();
/** The same DOM nodes in the same order (never deep-compared: too big). */
const sameNodes = (a, b) =>
  a.length === b.length && a.every((node, i) => node === b[i]);

beforeEach(() => {
  window.happyDOM.setViewport({ width: 1440, height: 900 });
});

afterEach(() => {
  hud?.destroy();
  hud = null;
  window.matchMedia = realMatchMedia;
  mock.timers.reset();
  document.activeElement?.blur?.();
});

/* ---------------------------------- pure --------------------------------- */

test('hudStatus: LIVE, DELAYED, OFFLINE and LOADING with the sources reporting', () => {
  assert.deepEqual(hudStatus(live(body())), {
    state: 'live',
    label: 'LIVE',
    sources: '1 of 2 sources',
  });
  assert.equal(hudStatus(live(body(), 'Events HTTP 502')).state, 'delayed');
  // No good read for over three refreshes: not LIVE, whatever is shown.
  const at = 1_800_000_000_000;
  assert.equal(
    hudStatus({ ...live(body()), readAt: at }, at + 60_000).state,
    'live',
  );
  assert.equal(
    hudStatus({ ...live(body()), readAt: at }, at + 91_000).state,
    'delayed',
  );
  assert.equal(hudStatus(live(null, 'Events HTTP 502')).label, 'OFFLINE');
  assert.deepEqual(hudStatus(live(null)), {
    state: 'loading',
    label: 'LOADING',
    sources: '',
  });
  assert.equal(
    hudStatus(live(body([], { sources: [] }))).sources,
    'County feeds',
  );
});

test('the first row is the worst Right now line; expanded it lists them all', () => {
  assert.equal(worstSummaryLine(body()).text, '1 open: fire in Rio Grande');
  const host = document.createElement('div');
  host.innerHTML = hudSummaryHtml(live(body()));
  const row = host.querySelector('[data-hud="summary"]');
  assert.ok(row.classList.contains('tone-warn'));
  assert.equal(row.getAttribute('aria-expanded'), 'false');
  assert.equal(squash(row.textContent), 'Right now 1 open: fire in Rio Grande');
  assert.equal(host.querySelector('.gev-hud-summary-all'), null);
  host.innerHTML = hudSummaryHtml(live(body()), { expanded: true });
  assert.deepEqual(
    [...host.querySelectorAll('.gev-hud-summary-line')].map((li) =>
      squash(li.textContent),
    ),
    [
      'Coastal Flood Advisory until 10:00 PM NWS',
      '1 open: fire in Rio Grande Fire Wire scanner',
      'Power: 12 customers out ACE',
    ],
  );
  assert.match(host.textContent, /Unofficial\. In an emergency call 911\./);
  // Quiet and unavailable feeds say so.
  host.innerHTML = hudSummaryHtml(live(body([], { summary: { lines: [] } })));
  assert.match(host.textContent, /Nothing notable in the feeds right now\./);
  host.innerHTML = hudSummaryHtml(live(null, 'Events HTTP 500'));
  assert.match(host.textContent, /Live events are unavailable right now\./);
});

test('a line: Eastern time, icon, title · place; event text is escaped', () => {
  const host = document.createElement('div');
  host.innerHTML = hudLineHtml(fire, { now: NOW });
  assert.equal(
    squash(host.textContent),
    '6:36 PM 🚒 Fire reported · Rio Grande',
  );
  host.innerHTML = hudLineHtml(hostile, { now: NOW, expanded: true });
  assert.equal(host.querySelector('img, script, b, i'), null);
  assert.match(host.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(host.textContent, /"><script>alert\(2\)<\/script>/);
  assert.match(host.textContent, /Source: <i>Community<\/i>/);
  // Event text reaches no attribute but the escaped data-id.
  const allowed = new Set([
    'class',
    'type',
    'data-hud',
    'data-id',
    'aria-expanded',
    'aria-hidden',
  ]);
  for (const node of host.querySelectorAll('*'))
    for (const { name } of node.attributes)
      assert.ok(allowed.has(name), `unexpected attribute ${name}`);
});

/* -------------------------------- the box -------------------------------- */

test('show() fills the HUD while hidden, then shows it: status, summary, newest lines', () => {
  mount();
  assert.equal(el().hidden, true);
  hud.show(live(body()));
  assert.equal(el().hidden, false);
  assert.equal(el().dataset.state, 'live');
  assert.equal(el().querySelector('.gev-hud-state').textContent, 'LIVE');
  assert.equal(
    el().querySelector('.gev-hud-sources').textContent,
    '1 of 2 sources',
  );
  assert.match(
    el().querySelector('.gev-hud-summary').textContent,
    /1 open: fire in Rio Grande/,
  );
  assert.deepEqual(
    lines().map((li) => li.dataset.id),
    ['e-fire', 'e-road', 'e-alert', 'e-xss'],
  );
  assert.ok(lineOf('e-fire').classList.contains('tone-warn'));
  assert.ok(lineOf('e-road').classList.contains('tone-watch'));
  // Older than 30 minutes: dimmed.
  assert.ok(!lineOf('e-road').classList.contains('is-old'));
  assert.ok(lineOf('e-alert').classList.contains('is-old'));
  // Filled before it showed: nothing counts as new.
  assert.equal(hud.unread, 0);
  assert.equal(el().querySelector('.gev-hud-unread').hidden, true);
  assert.equal(el().querySelector('img, script'), null);
});

test('at most the newest 8 events, newest first, whatever order they come in', () => {
  mount();
  const many = Array.from({ length: 14 }, (_, i) => event(`e${i}`, i * 3));
  hud.show(live(body([...many].reverse())));
  assert.equal(lines().length, HUD_LINES);
  assert.deepEqual(
    lines().map((li) => li.dataset.id),
    many.slice(0, 8).map((item) => item.id),
  );
  hud.update(live(body([])));
  assert.equal(lines().length, 0);
  assert.match(
    el().querySelector('.gev-hud-empty').textContent,
    /No events in the last 48 hours/,
  );
});

test('clicking a line opens it in place; again, or Escape, folds it', () => {
  mount();
  hud.show(live(body()));
  const main = () => lineOf('e-road').querySelector('[data-hud="line"]');
  main().click();
  assert.equal(hud.expandedId, 'e-road');
  assert.equal(main().getAttribute('aria-expanded'), 'true');
  const detail = lineOf('e-road').querySelector('.gev-hud-detail');
  assert.ok(detail);
  assert.match(detail.textContent, /Source: 511NJ/);
  assert.equal(
    detail.querySelector('.gev-hud-age').textContent,
    '· 20 min ago',
  );
  // The rest of its thread, worded as the timeline words it.
  assert.deepEqual(
    [...detail.querySelectorAll('.gev-hud-thread-item')].map((li) =>
      squash(li.textContent),
    ),
    ['First report 6:36 PM 🚒 Fire reported · Rio Grande'],
  );
  // Close shows on phones only (CSS), where there is no Escape key.
  assert.deepEqual(
    [...detail.querySelectorAll('.gev-hud-actions button')].map(
      (b) => b.textContent,
    ),
    ['Fly to', 'More in Alerts', 'Close'],
  );

  // Opening another folds the first.
  lineOf('e-fire').querySelector('[data-hud="line"]').click();
  assert.equal(hud.expandedId, 'e-fire');
  assert.equal(lineOf('e-road').querySelector('.gev-hud-detail'), null);
  assert.match(
    lineOf('e-fire').querySelector('.gev-hud-thread-item').textContent,
    /Possibly related · same road: Route 47/,
  );
  assert.match(
    lineOf('e-fire').querySelector('.gev-hud-detail').textContent,
    /Structure fire · Middle Twp Fire/,
  );

  // Click again: folded.
  lineOf('e-fire').querySelector('[data-hud="line"]').click();
  assert.equal(hud.expandedId, null);

  // Escape folds and keeps the focus on the line; with nothing open it
  // passes through.
  lineOf('e-fire').querySelector('[data-hud="line"]').click();
  const escape = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  lineOf('e-fire').querySelector('[data-hud="more"]').dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(hud.expandedId, null);
  assert.equal(
    document.activeElement,
    lineOf('e-fire').querySelector('[data-hud="line"]'),
  );
  const again = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  el().dispatchEvent(again);
  assert.equal(again.defaultPrevented, false);
});

test('Fly to, Show on map, More in Alerts, Open Alerts and × call back', () => {
  mount();
  hud.show(live(body()));
  hud.expand('e-fire');
  lineOf('e-fire').querySelector('[data-hud="fly"]').click();
  lineOf('e-fire').querySelector('[data-hud="more"]').click();
  // A layer but no position: it shows the layer instead of flying.
  hud.expand('e-alert');
  const show = lineOf('e-alert').querySelector('[data-hud="fly"]');
  assert.equal(show.textContent, 'Show on map');
  show.click();
  // Nowhere to go: only More in Alerts.
  hud.expand('e-xss');
  assert.equal(lineOf('e-xss').querySelector('[data-hud="fly"]'), null);
  lineOf('e-xss').querySelector('[data-hud="more"]').click();
  el().querySelector('[data-hud="open"]').click();
  el().querySelector('[data-hud="close"]').click();
  assert.deepEqual(calls, [
    ['fly', 'e-fire'],
    ['more', 'e-fire'],
    ['fly', 'e-alert'],
    ['more', 'e-xss'],
    ['open'],
    ['close'],
  ]);
  // expand() of an unknown event does nothing.
  assert.equal(hud.expand('nope'), false);
});

test('the Right now row opens to every summary line', () => {
  mount();
  hud.show(live(body()));
  const row = el().querySelector('[data-hud="summary"]');
  row.click();
  assert.equal(
    el().querySelector('[data-hud="summary"]').getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(el().querySelectorAll('.gev-hud-summary-line').length, 3);
  el().querySelector('[data-hud="summary"]').click();
  assert.equal(el().querySelector('.gev-hud-summary-all'), null);
});

test('new events while shown: highlighted, counted unread until hovered or focused', () => {
  mount();
  hud.show(live(body()));
  const water = event('e-water', 1, {
    title: 'Water rescue',
    severity: 'danger',
  });
  hud.update(live(body([water, fire, road, advisory, hostile])));
  assert.equal(hud.unread, 1);
  const badge = el().querySelector('.gev-hud-unread');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '1 new');
  assert.equal(lines()[0].dataset.id, 'e-water');
  assert.ok(lineOf('e-water').classList.contains('is-new'));
  assert.ok(!lineOf('e-fire').classList.contains('is-new'));
  // Two more arrive: 3 unread.
  hud.update(
    live(body([event('a', 0), event('b', 0), water, fire, road, advisory])),
  );
  assert.equal(hud.unread, 3);
  el().dispatchEvent(new PointerEvent('pointerenter'));
  assert.equal(hud.unread, 0);
  assert.equal(badge.hidden, true);
  // While the pointer rests on it, new lines glow but nothing piles up.
  hud.update(live(body([event('c', 0), event('a', 0), event('b', 0), water])));
  assert.equal(hud.unread, 0);
  assert.ok(lineOf('c').classList.contains('is-new'));
  el().dispatchEvent(new PointerEvent('pointerleave'));
  hud.update(live(body([event('d', 0), event('c', 0), event('a', 0)])));
  assert.equal(hud.unread, 1);
  el()
    .querySelector('[data-hud="open"]')
    .dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  assert.equal(hud.unread, 0);
  // While the focus is inside it (the grip, right after Shrink to HUD),
  // nothing piles up either.
  el().querySelector('.gev-hud-grip').focus();
  hud.update(live(body([event('e', 0), event('d', 0), event('c', 0)])));
  assert.equal(hud.unread, 0);
  assert.ok(lineOf('e').classList.contains('is-new'));
  document.activeElement.blur();
  hud.update(live(body([event('f', 0), event('e', 0), event('d', 0)])));
  assert.equal(hud.unread, 1);
});

test('the first answer after showing empty is not news', () => {
  mount();
  hud.show(live(null));
  assert.equal(el().dataset.state, 'loading');
  hud.update(live(body()));
  assert.equal(hud.unread, 0);
  assert.equal(el().querySelectorAll('.is-new').length, 0);
});

test('reduced motion: the HUD carries is-reduced-motion and new lines do not animate', () => {
  window.matchMedia = (query) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  mount();
  hud.show(live(body()));
  assert.ok(el().classList.contains('is-reduced-motion'));
  hud.hide();
  window.matchMedia = () => ({ matches: false });
  hud.show(live(body()));
  assert.ok(!el().classList.contains('is-reduced-motion'));
});

test('only genuinely new events are announced, once, in a hidden log', async () => {
  mount();
  hud.show(live(body()));
  const list = el().querySelector('.gev-hud-lines');
  // The visible list is a list, with no live attributes.
  assert.equal(list.tagName, 'OL');
  assert.equal(list.hasAttribute('role'), false);
  assert.equal(list.hasAttribute('aria-live'), false);
  // The one live region is the hidden announcer.
  const log = announcer();
  const liveRegions = [...el().querySelectorAll('[aria-live]')];
  assert.equal(liveRegions.length, 1, 'nothing else is live');
  assert.ok(liveRegions[0] === log);
  assert.equal(log.getAttribute('role'), 'log');
  assert.equal(log.getAttribute('aria-live'), 'polite');
  assert.equal(log.getAttribute('aria-relevant'), 'additions');
  // Filled before it showed: nothing said.
  assert.equal(log.children.length, 0);

  const said = [];
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) said.push(node);
  });
  observer.observe(log, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const before = lines();
  const html = before.map((li) => li.innerHTML);

  // A refresh with nothing new: nothing said, no line touched.
  hud.update(live(body()));
  await settle();
  assert.equal(said.length, 0);
  assert.ok(sameNodes(lines(), before));
  assert.deepEqual(
    lines().map((li) => li.innerHTML),
    html,
  );

  // Opening and closing a line, and the age ticking on, say nothing; the
  // line's button stays the same element.
  const main = lineOf('e-road').querySelector('[data-hud="line"]');
  main.click();
  await settle();
  assert.equal(lineOf('e-road').querySelector('[data-hud="line"]'), main);
  assert.ok(lineOf('e-road').querySelector('.gev-hud-detail'));
  hud.update(live(body()));
  main.click();
  await settle();
  assert.equal(lineOf('e-road').querySelector('.gev-hud-detail'), null);
  assert.equal(said.length, 0);

  // One new event: exactly one plain line said, and one line drawn at the top.
  const water = event('e-water', 1, { title: 'Water rescue' });
  hud.update(live(body([water, fire, road, advisory, hostile])));
  await settle();
  assert.equal(said.length, 1);
  assert.equal(
    said[0].textContent,
    'New event: Water rescue · Rio Grande, 6:45 PM',
  );
  assert.equal(said[0].children.length, 0, 'plain text');
  assert.equal(lines()[0].dataset.id, 'e-water');
  assert.ok(sameNodes(lines().slice(1), before));

  // The same event again, and an older event the ticker opened: not news.
  hud.update(live(body([water, fire, road, advisory, hostile])));
  const many = Array.from({ length: 10 }, (_, i) => event(`n${i}`, 0));
  hud.update(live(body([...many, water, fire, road, advisory, hostile])));
  await settle();
  said.length = 0;
  assert.equal(hud.expand('e-xss'), true);
  await settle();
  assert.equal(said.length, 0);
  // The log keeps only its last few lines.
  assert.ok(log.children.length <= 6);
  observer.disconnect();
});

test('hudAnnouncement words a new event as one plain line', () => {
  assert.equal(
    hudAnnouncement(fire, NOW),
    'New event: Fire reported · Rio Grande, 6:36 PM',
  );
  assert.equal(
    hudAnnouncement(event('x', 1, { place: '', title: '<b>x</b>' }), NOW),
    'New event: <b>x</b>, 6:45 PM',
  );
});

test('the title strip moves the HUD by drag and arrow keys; double-click resets it', () => {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  mount();
  hud.show(live(body()));
  const box = el();
  setBox(box, { left: 52, top: 600, width: 340, height: 212 });
  const head = box.querySelector('.gev-hud-head');
  head.dispatchEvent(pointer('pointerdown', 120, 610));
  head.dispatchEvent(pointer('pointermove', 520, 210));
  head.dispatchEvent(pointer('pointerup', 520, 210));
  assert.ok(box.classList.contains('is-placed'));
  assert.equal(box.style.left, '452px');
  assert.equal(box.style.top, '200px');
  assert.deepEqual(calls.at(-1), ['move', { x: 452, y: 200 }]);
  // Buttons on the strip never drag.
  head
    .querySelector('[data-hud="open"]')
    .dispatchEvent(pointer('pointerdown', 300, 210));
  head.dispatchEvent(pointer('pointermove', 900, 800));
  assert.equal(box.style.left, '452px');
  head.dispatchEvent(pointer('pointerup', 900, 800));

  const grip = box.querySelector('.gev-hud-grip');
  assert.equal(grip.getAttribute('role'), 'button');
  assert.equal(
    grip.getAttribute('aria-label'),
    'Move the events HUD, use arrow keys',
  );
  grip.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  );
  assert.equal(box.style.top, '216px');
  grip.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      shiftKey: true,
      bubbles: true,
    }),
  );
  assert.equal(box.style.left, '388px');
  assert.deepEqual(calls.at(-1), ['move', { x: 388, y: 216 }]);

  // Right after a drag, a double-click is the drag's own click plus one:
  // ignored. Later, it puts the HUD back in its usual spot.
  head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.ok(box.classList.contains('is-placed'));
  mock.timers.tick(600);
  head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.ok(!box.classList.contains('is-placed'));
  assert.equal(box.style.left, '');
  assert.deepEqual(calls.at(-1), ['move', null]);
});

test('Enter on the grip puts the HUD back in its usual spot', () => {
  mount({ position: { x: 300, y: 200 } });
  hud.show(live(body()));
  assert.ok(el().classList.contains('is-placed'));
  const enter = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  el().querySelector('.gev-hud-grip').dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.ok(!el().classList.contains('is-placed'));
  assert.equal(hud.position, null);
  assert.deepEqual(calls.at(-1), ['move', null]);
});

test('a drag ends when the HUD loses the pointer: hovering never moves it', () => {
  mount({ position: { x: 300, y: 200 } });
  hud.show(live(body()));
  const box = el();
  setBox(box, { left: 300, top: 200, width: 340, height: 212 });
  const head = box.querySelector('.gev-hud-head');
  head.dispatchEvent(pointer('pointerdown', 320, 210));
  head.dispatchEvent(pointer('pointermove', 420, 310));
  assert.equal(box.style.left, '400px');
  head.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 3 }));
  assert.ok(!head.classList.contains('is-dragging'));
  assert.deepEqual(calls.at(-1), ['move', { x: 400, y: 300 }]);
  head.dispatchEvent(pointer('pointermove', 900, 700, { buttons: 0 }));
  assert.equal(box.style.left, '400px');
  // Dragged against the left edge, its grip stays on screen.
  setBox(box, { left: 400, top: 300, width: 340, height: 212 });
  head.dispatchEvent(pointer('pointerdown', 410, 310));
  head.dispatchEvent(pointer('pointermove', -900, 310));
  assert.equal(box.style.left, '0px');
  head.dispatchEvent(pointer('pointerup', -900, 310));
  assert.deepEqual(calls.at(-1), ['move', { x: 0, y: 300 }]);
});

test('a stored spot is used, kept whole on screen', () => {
  mount({ position: { x: 4000, y: 4000 } });
  hud.show(live(body()));
  // Not a 64 px corner over the language button: the whole HUD.
  assert.equal(el().style.left, `${1440 - 340}px`);
  assert.equal(el().style.top, `${900 - 220}px`);
});

test('a moved HUD that grows stays whole on screen, without moving its spot', () => {
  mount({ position: { x: 200, y: 600 } });
  const box = el();
  let height = 212;
  box.getBoundingClientRect = () => ({
    left: 200,
    top: 600,
    width: 340,
    height,
    right: 540,
    bottom: 600 + height,
  });
  hud.show(live(body()));
  assert.equal(box.style.top, '600px');
  // An open line makes it 330 px tall: it rises to fit.
  height = 330;
  hud.expand('e-fire');
  assert.equal(box.style.top, `${900 - 330}px`);
  // The spot it remembers is still the user's own, and nothing was stored.
  assert.deepEqual(hud.position, { x: 200, y: 600 });
  assert.ok(!calls.some(([name]) => name === 'move'));
  // Closed again: back where it was put.
  height = 212;
  hud.collapse();
  assert.equal(box.style.top, '600px');
});

test('its usual spot is measured on the page: by the location bar, above the dock', () => {
  const made = [];
  const part = (id, box, parent = document.body) => {
    const node = document.createElement('div');
    node.id = id;
    node.getBoundingClientRect = () => ({
      ...box,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
    parent.appendChild(node);
    made.push(node);
    return node;
  };
  window.happyDOM.setViewport({ width: 1280, height: 720 });
  const dock = part('command-dock', {
    left: 403,
    top: 644,
    right: 877,
    bottom: 706,
  });
  part('location-bar', { left: 403, top: 644, right: 552, bottom: 706 }, dock);
  part(
    'gev-voice-control',
    { left: 552, top: 628, right: 728, bottom: 714 },
    dock,
  );
  part('gev-county-ticker', { left: 223, top: 100, right: 1057, bottom: 130 });
  try {
    mount();
    hud.show(live(body()));
    const style = el().style;
    assert.equal(el().classList.contains('is-placed'), false);
    assert.equal(style.getPropertyValue('--gev-hud-left'), '403px');
    assert.equal(style.getPropertyValue('--gev-hud-bottom'), `${720 - 620}px`);
    assert.equal(style.getPropertyValue('--gev-hud-max-h'), '330px');
  } finally {
    made.forEach((node) => node.remove());
  }
});

test('on a phone the strip sits above the tab bar and does not drag', () => {
  const bar = document.createElement('nav');
  bar.id = 'mobile-tab-bar';
  bar.getBoundingClientRect = () => ({
    left: 0,
    top: 754,
    width: 375,
    height: 58,
    right: 375,
    bottom: 812,
  });
  document.body.appendChild(bar);
  try {
    window.happyDOM.setViewport({ width: 375, height: 812 });
    mount({ isPhone: () => true, position: { x: 30, y: 40 } });
    hud.show(live(body()));
    const box = el();
    assert.equal(box.classList.contains('is-placed'), false);
    assert.equal(box.style.left, '');
    assert.equal(box.style.getPropertyValue('--gev-hud-phone-bottom'), '64px');
    const head = box.querySelector('.gev-hud-head');
    head.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: 100,
        clientY: 700,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
      }),
    );
    head.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 100,
        clientY: 300,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
      }),
    );
    assert.equal(box.style.top, '');
    assert.ok(!calls.some(([name]) => name === 'move'));
    // Tapping a line opens its card with Fly to, More in Alerts and Close.
    lineOf('e-fire').querySelector('[data-hud="line"]').click();
    assert.ok(
      lineOf('e-fire').querySelector('.gev-hud-detail [data-hud="fly"]'),
    );
    assert.ok(
      lineOf('e-fire').querySelector('.gev-hud-detail [data-hud="more"]'),
    );
    // Close folds the card, the focus back on its line.
    lineOf('e-fire').querySelector('[data-hud="fold"]').click();
    assert.equal(hud.expandedId, null);
    assert.equal(
      document.activeElement,
      lineOf('e-fire').querySelector('[data-hud="line"]'),
    );
    // Fly to: the map flies there and the card folds out of its way.
    lineOf('e-fire').querySelector('[data-hud="line"]').click();
    lineOf('e-fire').querySelector('[data-hud="fly"]').click();
    assert.deepEqual(calls.at(-1), ['fly', 'e-fire']);
    assert.equal(hud.expandedId, null);
  } finally {
    bar.remove();
  }
});

test('the phone strip follows the controls below it as they change', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const realRO = window.ResizeObserver;
  const watchers = [];
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.nodes = [];
      watchers.push(this);
    }
    observe(node) {
      this.nodes.push(node);
    }
    disconnect() {
      this.nodes = [];
    }
  };
  const made = [];
  const part = (id, box) => {
    const node = document.createElement('div');
    node.id = id;
    node.getBoundingClientRect = () => ({
      ...box,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
    document.body.appendChild(node);
    made.push(node);
    return node;
  };
  window.happyDOM.setViewport({ width: 375, height: 812 });
  part('mobile-tab-bar', { left: 0, top: 754, right: 375, bottom: 812 });
  const voice = part('gev-voice-control', {
    left: 48,
    top: 658,
    right: 328,
    bottom: 744,
  });
  try {
    mount({ isPhone: () => true });
    hud.show(live(body()));
    const strip = () => el().style.getPropertyValue('--gev-hud-phone-bottom');
    assert.equal(strip(), `${812 - 658 + 6}px`);
    const watcher = watchers.at(-1);
    assert.ok(watcher.nodes.includes(voice), 'the voice dock is watched');
    // The voice dock closes (AI chat turned off): the strip drops to the bar.
    voice.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    });
    watcher.callback([]);
    mock.timers.tick(100);
    assert.equal(strip(), `${812 - 754 + 6}px`);
    // Hidden: nothing is watched any more.
    hud.hide();
    assert.deepEqual(watcher.nodes, []);
  } finally {
    made.forEach((node) => node.remove());
    window.ResizeObserver = realRO;
  }
});

test('a HUD the page hides (clean view…) is not shown, and says so', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const changes = [];
  const style = document.createElement('style');
  style.textContent = 'body.ui-clean-view #gev-events-hud { display: none; }';
  document.head.appendChild(style);
  try {
    mount({ onShownChange: (shown) => changes.push(shown) });
    hud.show(live(body()));
    assert.equal(hud.isOpen(), true);
    assert.equal(hud.isShown(), true);
    document.body.classList.add('ui-clean-view');
    await new Promise((resolve) => queueMicrotask(resolve));
    mock.timers.tick(100);
    assert.equal(hud.isOpen(), true);
    assert.equal(hud.isShown(), false);
    assert.deepEqual(changes, [false]);
    // New events while hidden are not counted.
    hud.update(live(body([event('z', 0), fire])));
    assert.equal(hud.unread, 0);
    document.body.classList.remove('ui-clean-view');
    await new Promise((resolve) => queueMicrotask(resolve));
    mock.timers.tick(100);
    assert.equal(hud.isShown(), true);
    assert.deepEqual(changes, [false, true]);
  } finally {
    document.body.classList.remove('ui-clean-view');
    style.remove();
  }
});

test('hide() folds the open line and clears unread; destroy() removes the HUD', () => {
  mount();
  hud.show(live(body()));
  hud.expand('e-fire');
  hud.update(live(body([event('n', 0), fire, road])));
  assert.equal(hud.unread, 1);
  hud.hide();
  assert.equal(el().hidden, true);
  assert.equal(hud.expandedId, null);
  assert.equal(hud.unread, 0);
  hud.destroy();
  assert.equal(document.getElementById('gev-events-hud'), null);
  hud = null;
});

test('a HUD dropped over the map credits slides up above them', () => {
  window.happyDOM.setViewport({ width: 1280, height: 720 });
  const credits = document.createElement('div');
  credits.id = 'cesium-credits';
  const line = document.createElement('div');
  line.getBoundingClientRect = () => ({
    left: 24,
    top: 598,
    right: 363,
    bottom: 626,
    width: 339,
    height: 28,
  });
  credits.appendChild(line);
  document.body.appendChild(credits);
  try {
    mount({ position: { x: 300, y: 200 } });
    hud.show(live(body()));
    const box = el();
    setBox(box, { left: 300, top: 200, width: 340, height: 100 });
    const head = box.querySelector('.gev-hud-head');
    head.dispatchEvent(pointer('pointerdown', 310, 210));
    head.dispatchEvent(pointer('pointermove', 20, 610));
    // While dragging it may pass over them…
    assert.equal(box.style.top, '600px');
    head.dispatchEvent(pointer('pointerup', 20, 610));
    // …but it comes to rest above them, and that is the spot stored.
    assert.equal(box.style.top, `${598 - 8 - 100}px`);
    assert.deepEqual(calls.at(-1), ['move', { x: 10, y: 490 }]);
  } finally {
    credits.remove();
  }
});
