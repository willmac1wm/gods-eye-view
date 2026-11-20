import '../testSupport/registerDom.mjs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCK_WIDTH,
  WINDOW_STORAGE_KEY,
  bottomObstacles,
  clampPosition,
  clearOfBottom,
  containPosition,
  createPanelWindow,
  defaultLayout,
  dockRect,
  floatDefaultHeight,
  hudAnchor,
  installDrag,
  leaveHud,
  measureDockBounds,
  panelModeOf,
  parseLayout,
  phoneHudBottom,
  readLayout,
  serializeLayout,
  windowControlsHtml,
  windowGripHtml,
  withMode,
  writeLayout,
} from './panelWindow.js';

/*
 * The Local panel's window: clamping, the stored layout (corrupt storage
 * included), mode changes, the dock rectangle, and the installer driven by
 * real pointer and keyboard events in a DOM.
 */

const VIEW = Object.freeze({ w: 1440, h: 900 });

/** A Storage stand-in; `fail` makes every call throw (private modes). */
function memoryStorage({ fail = false, initial = null } = {}) {
  const data = new Map(initial === null ? [] : [[WINDOW_STORAGE_KEY, initial]]);
  return {
    data,
    getItem(key) {
      if (fail) throw new Error('SecurityError');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (fail) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    stored() {
      return JSON.parse(data.get(WINDOW_STORAGE_KEY));
    },
  };
}

/* ------------------------------- clamping -------------------------------- */

test('during a drag a window may hang off the right and bottom, never the left', () => {
  const size = { w: 620, h: 640 };
  // Inside: unchanged.
  assert.deepEqual(clampPosition({ x: 300, y: 120 }, size, VIEW), {
    x: 300,
    y: 120,
  });
  // Off the left: the handles are on the left, so it stops at the edge.
  assert.deepEqual(clampPosition({ x: -2000, y: 120 }, size, VIEW), {
    x: 0,
    y: 120,
  });
  // Off the right and the bottom: 64 px stay on screen.
  assert.deepEqual(clampPosition({ x: 5000, y: 5000 }, size, VIEW), {
    x: 1440 - 64,
    y: 900 - 64,
  });
  // The header never goes above the top edge.
  assert.deepEqual(clampPosition({ x: 10, y: -40 }, size, VIEW).y, 0);
  // Nonsense reads as the corner; fractions round.
  assert.deepEqual(clampPosition({ x: NaN, y: 'a' }, size, VIEW), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(clampPosition({ x: 10.6, y: 20.4 }, size, VIEW), {
    x: 11,
    y: 20,
  });
  // A tiny screen still gives a position, never NaN.
  const tiny = clampPosition({ x: 50, y: 50 }, size, { w: 40, h: 30 });
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y));
});

test('at rest a window is kept whole on screen when it fits', () => {
  const size = { w: 620, h: 640 };
  assert.deepEqual(containPosition({ x: 300, y: 120 }, size, VIEW), {
    x: 300,
    y: 120,
  });
  assert.deepEqual(containPosition({ x: 5000, y: 5000 }, size, VIEW), {
    x: 1440 - 620,
    y: 900 - 640,
  });
  assert.deepEqual(containPosition({ x: -50, y: -50 }, size, VIEW), {
    x: 0,
    y: 0,
  });
  // Bigger than the screen: its top-left corner, where its handles are.
  assert.deepEqual(
    containPosition({ x: 200, y: 200 }, { w: 2000, h: 2000 }, VIEW),
    { x: 0, y: 0 },
  );
  assert.deepEqual(containPosition({ x: NaN, y: 'a' }, size, VIEW), {
    x: 0,
    y: 0,
  });
});

/* ------------------------------ persistence ------------------------------ */

test('a missing, corrupt or hostile stored layout reads as the default', () => {
  for (const raw of [
    null,
    undefined,
    '',
    '{not json',
    'null',
    '42',
    '"float"',
    '[]',
    JSON.stringify({ mode: { evil: true }, float: 'x', hud: [] }),
  ])
    assert.deepEqual(parseLayout(raw, VIEW), defaultLayout(), String(raw));
});

test('parseLayout keeps what is sound and repairs the rest', () => {
  const layout = parseLayout(
    JSON.stringify({
      mode: 'dock-right',
      float: { x: 200.4, y: 'nope', w: 700, h: 100 },
      dockWidth: 9999,
      hud: { open: false, x: 30, y: 40, expandedFrom: 'sideways' },
    }),
    VIEW,
  );
  assert.equal(layout.mode, 'dock-right');
  // Half a position is no position; a height under the minimum is dropped.
  assert.deepEqual(layout.float, { x: null, y: null, w: 700, h: null });
  assert.equal(layout.dockWidth, DOCK_WIDTH.max);
  assert.deepEqual(layout.hud, {
    open: false,
    x: 30,
    y: 40,
    expandedFrom: 'float',
  });
  assert.equal(parseLayout({ dockWidth: 10 }).dockWidth, DOCK_WIDTH.min);
  assert.equal(parseLayout({ mode: 'sideways' }).mode, 'float');
});

test('the HUD is open exactly when the mode is hud', () => {
  // Stored as open: the HUD mode, remembering the panel mode it came from.
  assert.deepEqual(
    parseLayout({ mode: 'dock-left', hud: { open: true } }).hud.expandedFrom,
    'dock-left',
  );
  assert.equal(
    parseLayout({ mode: 'dock-left', hud: { open: true } }).mode,
    'hud',
  );
  // 'hud' with the HUD closed: back to the panel mode.
  const closed = parseLayout({
    mode: 'hud',
    hud: { open: false, expandedFrom: 'dock-right' },
  });
  assert.equal(closed.mode, 'dock-right');
  assert.equal(closed.hud.open, false);
});

test('stored positions and sizes are fitted to the screen they are read on', () => {
  const stored = JSON.stringify({
    mode: 'float',
    float: { x: 3000, y: 2000, w: 620, h: 640 },
    hud: { open: true, x: -5000, y: 4000 },
  });
  const layout = parseLayout(stored, { w: 1024, h: 700 });
  // The whole window on screen, not just a corner of it.
  assert.deepEqual(
    { x: layout.float.x, y: layout.float.y },
    { x: 1024 - 620, y: 700 - 640 },
  );
  assert.deepEqual(
    { x: layout.hud.x, y: layout.hud.y },
    { x: 0, y: 700 - 220 },
  );
  // A size saved on a bigger monitor is capped to this one (CSS keeps the
  // panel 16 px smaller than the screen); the position follows.
  const big = parseLayout(
    { float: { x: 900, y: 500, w: 1800, h: 1100 } },
    { w: 1280, h: 720 },
  );
  assert.deepEqual(big.float, { x: 16, y: 16, w: 1280 - 16, h: 720 - 16 });
  // Never under the minimum size, however small the screen.
  assert.deepEqual(
    parseLayout({ float: { w: 700, h: 500 } }, { w: 300, h: 200 }).float,
    { x: null, y: null, w: 320, h: 280 },
  );
});

test('readLayout and writeLayout survive storage that throws', () => {
  const broken = memoryStorage({ fail: true });
  assert.deepEqual(readLayout(broken, VIEW), defaultLayout());
  assert.equal(writeLayout(broken, defaultLayout()), false);
  assert.deepEqual(readLayout(null, VIEW), defaultLayout());
  assert.equal(writeLayout(null, defaultLayout()), false);

  const corrupt = memoryStorage({ initial: '{"mode":"dock-left",' });
  assert.deepEqual(readLayout(corrupt, VIEW), defaultLayout());

  const good = memoryStorage();
  const layout = withMode(defaultLayout(), 'dock-left');
  assert.equal(writeLayout(good, layout), true);
  assert.deepEqual(readLayout(good, VIEW), layout);
  assert.deepEqual(JSON.parse(serializeLayout(layout)), layout);
});

test('mode changes: shrinking remembers the panel mode, expanding restores it', () => {
  let layout = withMode(defaultLayout(), 'dock-right');
  assert.equal(layout.mode, 'dock-right');
  layout = withMode(layout, 'hud');
  assert.equal(layout.mode, 'hud');
  assert.deepEqual(
    { open: layout.hud.open, from: layout.hud.expandedFrom },
    { open: true, from: 'dock-right' },
  );
  assert.equal(panelModeOf(layout), 'dock-right');
  // Shrinking twice keeps the first mode.
  assert.equal(withMode(layout, 'hud').hud.expandedFrom, 'dock-right');
  layout = leaveHud(layout);
  assert.equal(layout.mode, 'dock-right');
  assert.equal(layout.hud.open, false);
  // Any panel mode closes the HUD.
  assert.equal(withMode(withMode(layout, 'hud'), 'float').hud.open, false);
  // An unknown mode changes nothing.
  assert.equal(withMode(layout, 'sideways').mode, 'dock-right');
});

/* --------------------------------- docking -------------------------------- */

test('a docked column sits beside the rail when it fits, over it when not', () => {
  const bounds = { top: 130, bottom: 820, leftEdge: 195, rightEdge: 1239 };
  const right = dockRect({ side: 'right', viewport: VIEW, ...bounds });
  assert.deepEqual(right, {
    side: 'right',
    left: 1239 - 8 - 380,
    right: 1440 - (1239 - 8 - 380) - 380,
    top: 138,
    width: 380,
    height: 812 - 138,
    beside: true,
  });
  const left = dockRect({ side: 'left', viewport: VIEW, ...bounds });
  assert.equal(left.left, 195 + 8);
  assert.equal(left.beside, true);

  // A narrow screen: beside the right rail it would cover the left rail, so
  // it docks at the edge over the rail (reachable again once closed).
  const narrow = dockRect({
    side: 'right',
    viewport: { w: 800, h: 700 },
    top: 130,
    bottom: 640,
    leftEdge: 300,
    rightEdge: 600,
    width: 380,
  });
  assert.equal(narrow.beside, false);
  assert.equal(narrow.left, 800 - 12 - 380);
  assert.equal(narrow.right, 12);
});

test('a docked column falls back to fixed margins and keeps its width in range', () => {
  const rect = dockRect({ side: 'left', viewport: VIEW, width: 9000 });
  assert.equal(rect.top, 96);
  assert.equal(rect.height, 900 - 96 - 96);
  assert.equal(rect.width, DOCK_WIDTH.max);
  assert.equal(rect.left, 12);
  assert.equal(rect.beside, false);
  assert.equal(
    dockRect({ side: 'right', viewport: VIEW, width: 1 }).width,
    DOCK_WIDTH.min,
  );
});

test('measureDockBounds reads the shown top bar, dock and rails', () => {
  const made = [];
  const box = (id, rect, parent = document.body, hidden = false) => {
    const el = document.createElement('div');
    if (id) el.id = id;
    if (hidden) el.style.display = 'none';
    el.getBoundingClientRect = () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    });
    parent.appendChild(el);
    made.push(el);
    return el;
  };
  try {
    box('top-center-actions', { left: 548, top: 32, width: 344, height: 36 });
    box('gev-county-ticker', { left: 254, top: 100, width: 932, height: 30 });
    box('command-dock', { left: 469, top: 820, width: 502, height: 62 });
    const leftStack = box('left-panel-stack', {
      left: 100,
      top: 234,
      width: 360,
      height: 432,
    });
    box(null, { left: 52, top: 234, width: 143, height: 110 }, leftStack);
    const rightStack = box('right-context-rail', {
      left: 1010,
      top: 234,
      width: 330,
      height: 0,
    });
    box(null, { left: 1239, top: 234, width: 149, height: 144 }, rightStack);
    // A hidden panel in the rail does not count.
    box(
      null,
      { left: 900, top: 234, width: 300, height: 400 },
      rightStack,
      true,
    );
    const bounds = measureDockBounds(document, VIEW);
    assert.deepEqual(
      {
        top: bounds.top,
        bottom: bounds.bottom,
        leftEdge: bounds.leftEdge,
        rightEdge: bounds.rightEdge,
      },
      { top: 130, bottom: 820, leftEdge: 195, rightEdge: 1239 },
    );
    // The dock is also something the column must stay above.
    assert.deepEqual(
      bounds.obstacles.map((rect) => rect.top),
      [820],
    );
  } finally {
    made.forEach((el) => el.remove());
  }
  assert.deepEqual(measureDockBounds(document, VIEW), {
    top: null,
    bottom: null,
    leftEdge: null,
    rightEdge: null,
    obstacles: [],
  });
});

/* ------------------------------ the installer ----------------------------- */

let panel;
let header;
let handle;
let storage;
let ctl;
const realRO = window.ResizeObserver;
const realMatchMedia = window.matchMedia;
let observers;

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    observers.push(this);
  }
  observe() {}
  disconnect() {}
  fire() {
    this.callback([]);
  }
}

function mountPanel() {
  panel = document.createElement('section');
  panel.id = 'gev-local-main';
  panel.className = 'gev-local-panel';
  panel.innerHTML = `<header class="gev-local-head"><div class="gev-local-title">${windowGripHtml()}<div><h2>Local conditions</h2></div></div><div>${windowControlsHtml()}<button type="button" class="gev-local-close">×</button></div></header><div class="gev-local-body"></div>`;
  document.body.appendChild(panel);
  header = panel.querySelector('.gev-local-head');
  handle = panel.querySelector('.gev-win-grip');
}

/** The panel's on-screen box, as a browser would report it. */
function setRect(el, { left, top, width, height }) {
  el.getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  });
}

/** A mouse event; the button is held down except on pointerup. */
const pointer = (type, x, y, extra = {}) =>
  new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 7,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    isPrimary: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
const key = (name, extra = {}) =>
  new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
const button = (mode) => panel.querySelector(`[data-win="${mode}"]`);

function install(options = {}) {
  ctl = createPanelWindow({
    panel,
    header,
    handle,
    storage,
    isPhone: () => false,
    ...options,
  });
  return ctl;
}

beforeEach(() => {
  observers = [];
  window.ResizeObserver = FakeResizeObserver;
  window.happyDOM.setViewport({ width: 1440, height: 900 });
  storage = memoryStorage();
  mountPanel();
});

afterEach(() => {
  ctl?.destroy();
  ctl = null;
  panel.remove();
  window.ResizeObserver = realRO;
  window.matchMedia = realMatchMedia;
  mock.timers.reset();
});

test('the header has the four window buttons with labels, titles and pressed state', () => {
  install();
  ctl.apply();
  const labels = [...panel.querySelectorAll('.gev-win-btn')].map((el) => [
    el.dataset.win,
    el.getAttribute('aria-label'),
    Boolean(el.title),
    el.getAttribute('aria-pressed'),
  ]);
  // "Shrink to HUD" is an action: no pressed state.
  assert.deepEqual(labels, [
    ['dock-left', 'Dock left', true, 'false'],
    ['dock-right', 'Dock right', true, 'false'],
    ['float', 'Float', true, 'true'],
    ['hud', 'Shrink to HUD', true, null],
  ]);
  // Float is the current mode, but its button only shows while docked.
  assert.equal(button('float').hidden, true);
  // A grip of its own is the keyboard "Move window" handle; the heading
  // beside it stays a heading.
  assert.equal(handle.getAttribute('role'), 'button');
  assert.equal(handle.getAttribute('tabindex'), '0');
  assert.equal(
    handle.getAttribute('aria-label'),
    'Move window, use arrow keys',
  );
  assert.equal(handle.hidden, false);
  const title = panel.querySelector('.gev-local-title');
  assert.equal(title.hasAttribute('role'), false);
  assert.ok(title.querySelector('h2'));
  assert.equal(panel.classList.contains('gev-win-float'), true);
});

test('dock buttons dock, a pressed one floats again, and every change is stored', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  assert.equal(ctl.mode, 'dock-right');
  assert.equal(button('dock-right').getAttribute('aria-pressed'), 'true');
  assert.equal(button('float').hidden, false);
  assert.ok(panel.classList.contains('gev-win-dock-right'));
  // No top bar, dock or rails in this page: the fallback margins.
  assert.equal(panel.style.top, '96px');
  assert.equal(panel.style.height, `${900 - 96 - 96}px`);
  assert.equal(panel.style.width, '380px');
  assert.equal(panel.style.right, '12px');
  assert.equal(storage.stored().mode, 'dock-right');

  button('dock-left').click();
  assert.equal(ctl.mode, 'dock-left');
  assert.equal(panel.style.left, '12px');
  assert.equal(button('dock-right').getAttribute('aria-pressed'), 'false');

  button('dock-left').click();
  assert.equal(ctl.mode, 'float');
  assert.equal(button('float').hidden, true);

  button('dock-right').click();
  button('float').click();
  assert.equal(ctl.mode, 'float');
  assert.equal(storage.stored().mode, 'float');
});

test('Shrink to HUD asks the shell and records where the panel was', () => {
  let shrinks = 0;
  install({ onShrink: () => (shrinks += 1) });
  ctl.apply();
  button('dock-left').click();
  button('hud').click();
  assert.equal(shrinks, 1);
  ctl.setMode('hud');
  assert.equal(ctl.mode, 'hud');
  assert.equal(ctl.panelMode, 'dock-left');
  assert.deepEqual(
    {
      open: storage.stored().hud.open,
      from: storage.stored().hud.expandedFrom,
    },
    { open: true, from: 'dock-left' },
  );
  assert.equal(ctl.leaveHud(), 'dock-left');
  assert.equal(storage.stored().hud.open, false);
  ctl.setHudPosition({ x: 40, y: 500 });
  assert.deepEqual(
    { x: storage.stored().hud.x, y: storage.stored().hud.y },
    { x: 40, y: 500 },
  );
});

test('arrow keys on the title move the panel 16 px, Shift 64 px, and are stored', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  handle.dispatchEvent(key('ArrowRight'));
  assert.equal(panel.style.left, '426px');
  assert.equal(panel.style.top, '96px');
  assert.ok(panel.classList.contains('is-placed'));
  setRect(panel, { left: 426, top: 96, width: 620, height: 640 });
  handle.dispatchEvent(key('ArrowDown', { shiftKey: true }));
  assert.equal(panel.style.top, '160px');
  handle.dispatchEvent(key('ArrowUp'));
  handle.dispatchEvent(key('ArrowLeft', { shiftKey: true }));
  assert.equal(panel.style.left, '362px');
  assert.equal(panel.style.top, '144px');
  assert.deepEqual(
    { x: storage.stored().float.x, y: storage.stored().float.y },
    { x: 362, y: 144 },
  );
  // Other keys pass through.
  const tab = key('Tab');
  handle.dispatchEvent(tab);
  assert.equal(tab.defaultPrevented, false);
  // Never past the screen: the whole panel stays on it.
  for (let i = 0; i < 40; i += 1)
    handle.dispatchEvent(key('ArrowUp', { shiftKey: true }));
  assert.equal(panel.style.top, '0px');
  for (let i = 0; i < 40; i += 1)
    handle.dispatchEvent(key('ArrowRight', { shiftKey: true }));
  assert.equal(panel.style.left, `${1440 - 620}px`);
});

test('Enter or Space on the grip re-centers the panel', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  handle.dispatchEvent(key('ArrowRight'));
  assert.ok(panel.classList.contains('is-placed'));
  const enter = key('Enter');
  handle.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.ok(!panel.classList.contains('is-placed'));
  assert.equal(storage.stored().float.x, null);
  handle.dispatchEvent(key('ArrowDown'));
  assert.ok(panel.classList.contains('is-placed'));
  handle.dispatchEvent(key(' '));
  assert.ok(!panel.classList.contains('is-placed'));
});

test('arrow keys on a docked panel undock it where it is', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  setRect(panel, { left: 1048, top: 96, width: 380, height: 708 });
  handle.dispatchEvent(key('ArrowLeft'));
  assert.equal(ctl.mode, 'float');
  assert.equal(panel.style.left, '1032px');
  assert.equal(panel.style.top, '96px');
});

test('dragging the header moves the panel; buttons in the header never drag', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointerdown', 500, 110));
  // Under 3 px: still a click.
  header.dispatchEvent(pointer('pointermove', 501, 111));
  assert.equal(panel.style.left, '');
  header.dispatchEvent(pointer('pointermove', 600, 300));
  assert.ok(header.classList.contains('is-dragging'));
  assert.equal(panel.style.left, '510px');
  assert.equal(panel.style.top, '286px');
  // Dragged far up and left: it stops at the edges, where its handles are.
  header.dispatchEvent(pointer('pointermove', -3000, -3000));
  assert.equal(panel.style.left, '0px');
  assert.equal(panel.style.top, '0px');
  // Off the right and bottom: it may hang off while the drag lasts…
  header.dispatchEvent(pointer('pointermove', 3000, 3000));
  assert.equal(panel.style.left, `${1440 - 64}px`);
  assert.equal(panel.style.top, `${900 - 64}px`);
  // …and comes back whole on screen once dropped.
  header.dispatchEvent(pointer('pointerup', 3000, 3000));
  assert.ok(!header.classList.contains('is-dragging'));
  assert.equal(panel.style.left, `${1440 - 620}px`);
  assert.equal(panel.style.top, `${900 - 640}px`);
  assert.deepEqual(
    { x: storage.stored().float.x, y: storage.stored().float.y },
    { x: 1440 - 620, y: 900 - 640 },
  );

  // A press on a button is a click, not a drag.
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  const close = panel.querySelector('.gev-local-close');
  close.dispatchEvent(pointer('pointerdown', 1000, 110));
  header.dispatchEvent(pointer('pointermove', 700, 400));
  header.dispatchEvent(pointer('pointerup', 700, 400));
  assert.equal(panel.style.left, `${1440 - 620}px`);
});

test('a drag that lost its pointerup ends: hovering never moves the panel', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointerdown', 500, 110));
  header.dispatchEvent(pointer('pointermove', 600, 200));
  assert.equal(panel.style.left, '510px');
  // Escape hides the panel mid-drag: the browser drops the capture.
  panel.hidden = true;
  header.dispatchEvent(
    new PointerEvent('lostpointercapture', { pointerId: 7 }),
  );
  assert.ok(!header.classList.contains('is-dragging'));
  assert.equal(storage.stored().float.x, 510);
  panel.hidden = false;
  // Back again, a mouse passing over the header (no button down) does not
  // move it, and a new press starts a new drag.
  header.dispatchEvent(pointer('pointermove', 900, 500, { buttons: 0 }));
  assert.equal(panel.style.left, '510px');
  setRect(panel, { left: 510, top: 186, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointerdown', 600, 200));
  header.dispatchEvent(pointer('pointermove', 650, 250));
  assert.equal(panel.style.left, '560px');
  header.dispatchEvent(pointer('pointerup', 650, 250));

  // The pointerup landed elsewhere and capture never came: the first move
  // with no button down ends the drag where it was.
  setRect(panel, { left: 560, top: 236, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointerdown', 600, 250));
  header.dispatchEvent(pointer('pointermove', 700, 300));
  assert.equal(panel.style.left, '660px');
  header.dispatchEvent(pointer('pointermove', 100, 100, { buttons: 0 }));
  assert.equal(panel.style.left, '660px');
  assert.ok(!header.classList.contains('is-dragging'));
  header.dispatchEvent(pointer('pointermove', 50, 50, { buttons: 0 }));
  assert.equal(panel.style.left, '660px');
});

test('only the main button drags', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointerdown', 500, 110, { button: 2 }));
  header.dispatchEvent(pointer('pointermove', 700, 300, { buttons: 2 }));
  assert.equal(panel.style.left, '');
  header.dispatchEvent(pointer('pointerup', 700, 300));
});

test('the click that ends a drag is not half of a double-click', () => {
  let clock = 1_000;
  install();
  ctl.apply();
  ctl.destroy();
  // The same installer with a clock the test moves.
  const moved = [];
  const centered = [];
  const dispose = installDrag({
    area: header,
    getRect: () => ({ left: 0, top: 0 }),
    onMove: ({ clientX }) => moved.push(clientX),
    onDoubleClick: () => centered.push(clock),
    now: () => clock,
  });
  try {
    header.dispatchEvent(pointer('pointerdown', 10, 10));
    header.dispatchEvent(pointer('pointermove', 60, 10));
    header.dispatchEvent(pointer('pointerup', 60, 10));
    assert.deepEqual(moved, [60]);
    clock += 200;
    header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert.deepEqual(centered, [], 'right after a drag: ignored');
    clock += 600;
    header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    assert.deepEqual(centered, [1_800]);
  } finally {
    dispose();
    ctl = null;
  }
});

test('dragging a docked panel undocks it to float at the drop point', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  setRect(panel, { left: 1048, top: 96, width: 380, height: 708 });
  header.dispatchEvent(pointer('pointerdown', 1100, 110));
  // Undocked, it takes its floating size.
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  header.dispatchEvent(pointer('pointermove', 700, 300));
  assert.equal(ctl.mode, 'float');
  assert.ok(panel.classList.contains('gev-win-float'));
  assert.ok(!panel.classList.contains('gev-win-dock'));
  // The pointer keeps its place on the header: 52 px in, 14 px down.
  assert.equal(panel.style.left, `${700 - 52}px`);
  assert.equal(panel.style.top, `${300 - 14}px`);
  header.dispatchEvent(pointer('pointerup', 700, 300));
  assert.equal(storage.stored().mode, 'float');
  assert.equal(button('dock-right').getAttribute('aria-pressed'), 'false');
});

test('double-clicking the header re-centers the panel', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  handle.dispatchEvent(key('ArrowRight'));
  assert.ok(panel.classList.contains('is-placed'));
  header.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  assert.ok(!panel.classList.contains('is-placed'));
  assert.equal(panel.style.left, '');
  assert.equal(storage.stored().float.x, null);
});

test('the panel is kept whole on screen when the browser window shrinks', () => {
  install();
  ctl.apply();
  setRect(panel, { left: 700, top: 200, width: 620, height: 500 });
  handle.dispatchEvent(key('ArrowRight'));
  assert.equal(panel.style.left, '716px');
  window.happyDOM.setViewport({ width: 800, height: 600 });
  window.dispatchEvent(new Event('resize'));
  assert.equal(panel.style.left, `${800 - 620}px`);
  assert.equal(panel.style.top, `${600 - 500}px`);
});

test('a stored layout is restored whole on screen on the next start', () => {
  storage = memoryStorage({
    initial: JSON.stringify({
      mode: 'float',
      float: { x: 5000, y: 5000, w: 700, h: 500 },
      dockWidth: 420,
    }),
  });
  install();
  ctl.apply();
  assert.equal(panel.style.width, '700px');
  assert.equal(panel.style.height, '500px');
  // Not a 64 px corner over the language button: the whole panel.
  assert.equal(panel.style.left, `${1440 - 700}px`);
  assert.equal(panel.style.top, `${900 - 500}px`);
  button('dock-left').click();
  assert.equal(panel.style.width, '420px');
});

test('a size saved on a bigger screen is capped to this one', () => {
  window.happyDOM.setViewport({ width: 1280, height: 720 });
  storage = memoryStorage({
    initial: JSON.stringify({
      mode: 'float',
      float: { x: 300, y: 200, w: 1700, h: 1000 },
    }),
  });
  install();
  ctl.apply();
  assert.equal(panel.style.width, `${1280 - 16}px`);
  assert.equal(panel.style.height, `${720 - 16}px`);
  assert.equal(panel.style.left, '16px');
  assert.equal(panel.style.top, '16px');
});

test('a corner resize is remembered once it settles; layout changes are not', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  install();
  ctl.apply();
  const [observer] = observers;
  assert.ok(observer, 'the panel is observed');
  // Showing and laying out the panel is not a resize by the user.
  observer.fire();
  mock.timers.tick(300);
  assert.equal(storage.data.has(WINDOW_STORAGE_KEY), false);
  // The browser writes the size the user dragged to.
  panel.style.width = '700px';
  panel.style.height = '520px';
  observer.fire();
  mock.timers.tick(100);
  observer.fire();
  mock.timers.tick(300);
  assert.deepEqual(
    { w: storage.stored().float.w, h: storage.stored().float.h },
    { w: 700, h: 520 },
  );
  // Docked, the corner sizes the column.
  button('dock-left').click();
  panel.style.width = '450px';
  observer.fire();
  mock.timers.tick(300);
  assert.equal(storage.stored().dockWidth, 450);
  assert.deepEqual(
    { w: storage.stored().float.w, h: storage.stored().float.h },
    { w: 700, h: 520 },
  );
});

test('the inner edge of a docked column sizes it', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  const edge = panel.querySelector('.gev-win-edge');
  setRect(panel, { left: 1048, top: 96, width: 380, height: 708 });
  edge.dispatchEvent(pointer('pointerdown', 1050, 400));
  edge.dispatchEvent(pointer('pointermove', 950, 400));
  assert.equal(panel.style.width, '480px');
  edge.dispatchEvent(pointer('pointermove', 400, 400));
  assert.equal(panel.style.width, `${DOCK_WIDTH.max}px`);
  edge.dispatchEvent(pointer('pointerup', 400, 400));
  assert.equal(storage.stored().dockWidth, DOCK_WIDTH.max);
});

test('the edge grip ignores other buttons and ends a drag that lost its pointerup', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  const edge = panel.querySelector('.gev-win-edge');
  setRect(panel, { left: 1048, top: 96, width: 380, height: 708 });
  // A right-click is not a resize.
  edge.dispatchEvent(pointer('pointerdown', 1050, 400, { button: 2 }));
  edge.dispatchEvent(pointer('pointermove', 950, 400, { buttons: 2 }));
  assert.equal(panel.style.width, '380px');
  // Capture lost mid-resize: the resize ends and is kept.
  edge.dispatchEvent(pointer('pointerdown', 1050, 400));
  edge.dispatchEvent(pointer('pointermove', 1000, 400));
  assert.equal(panel.style.width, '430px');
  edge.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 7 }));
  assert.equal(storage.stored().dockWidth, 430);
  edge.dispatchEvent(pointer('pointermove', 800, 400, { buttons: 0 }));
  assert.equal(panel.style.width, '430px');
  // A mouse moving with no button down ends a resize too.
  setRect(panel, { left: 998, top: 96, width: 430, height: 708 });
  edge.dispatchEvent(pointer('pointerdown', 1050, 400));
  edge.dispatchEvent(pointer('pointermove', 1040, 400));
  assert.equal(panel.style.width, '440px');
  edge.dispatchEvent(pointer('pointermove', 700, 400, { buttons: 0 }));
  edge.dispatchEvent(pointer('pointermove', 600, 400));
  assert.equal(panel.style.width, '440px');
});

test('leaving a dock with Float keeps the focus in the panel', () => {
  install();
  ctl.apply();
  button('dock-right').click();
  button('float').focus();
  assert.equal(document.activeElement, button('float'));
  button('float').click();
  assert.equal(ctl.mode, 'float');
  assert.equal(button('float').hidden, true);
  // Handed to the dock button of the side it left, not dropped to <body>.
  assert.equal(document.activeElement, button('dock-right'));
  // A dock button that floats the panel stays shown and keeps the focus.
  button('dock-left').click();
  button('dock-left').focus();
  button('dock-left').click();
  assert.equal(ctl.mode, 'float');
  assert.equal(document.activeElement, button('dock-left'));
});

test('a corner resize still settling is kept when the panel closes and opens', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  install();
  ctl.apply();
  const [observer] = observers;
  panel.style.width = '700px';
  panel.style.height = '520px';
  observer.fire();
  // Closed within the 250 ms: flushed first.
  assert.equal(ctl.flush(), true);
  panel.hidden = true;
  mock.timers.tick(300);
  assert.deepEqual(
    { w: storage.stored().float.w, h: storage.stored().float.h },
    { w: 700, h: 520 },
  );
  // Resized and opened again at once (no flush): apply() keeps it too.
  panel.hidden = false;
  panel.style.width = '640px';
  ctl.apply();
  assert.equal(panel.style.width, '640px');
  assert.equal(storage.stored().float.w, 640);
});

test('on a phone the panel stays a bottom sheet: no drag, no dock, no move handle', () => {
  let phone = true;
  install({ isPhone: () => phone });
  ctl.apply();
  assert.equal(panel.dataset.window, 'sheet');
  // No move grip on a phone (hidden, so not focusable).
  assert.equal(handle.hidden, true);
  setRect(panel, { left: 0, top: 400, width: 375, height: 400 });
  header.dispatchEvent(pointer('pointerdown', 100, 410));
  header.dispatchEvent(pointer('pointermove', 200, 200));
  header.dispatchEvent(pointer('pointerup', 200, 200));
  handle.dispatchEvent(key('ArrowUp'));
  assert.equal(panel.style.left, '');
  assert.equal(panel.style.top, '');
  assert.equal(panel.classList.contains('gev-win-float'), false);
  // A stored dock does not apply on a phone.
  ctl.setMode('dock-right');
  assert.equal(panel.style.right, '');
  assert.equal(panel.dataset.window, 'sheet');
  // Wider again: the dock applies.
  phone = false;
  window.dispatchEvent(new Event('resize'));
  assert.equal(panel.dataset.window, 'dock-right');
  assert.equal(panel.style.right, '12px');
  assert.equal(handle.hidden, false);
});

test('destroy removes the listeners and the edge grip', () => {
  install();
  ctl.apply();
  ctl.destroy();
  assert.equal(panel.querySelector('.gev-win-edge'), null);
  setRect(panel, { left: 410, top: 96, width: 620, height: 640 });
  handle.dispatchEvent(key('ArrowRight'));
  button('dock-left').click();
  assert.equal(panel.style.left, '');
  assert.equal(storage.data.has(WINDOW_STORAGE_KEY), false);
  ctl = null;
});

test('a docked column moves beside a side panel that opens in its rail', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const stack = document.createElement('div');
  stack.id = 'left-panel-stack';
  const rail = document.createElement('div');
  stack.appendChild(rail);
  document.body.appendChild(stack);
  let railRect = { left: 52, top: 234, width: 143, height: 110 };
  rail.getBoundingClientRect = () => ({
    ...railRect,
    right: railRect.left + railRect.width,
    bottom: railRect.top + railRect.height,
  });
  try {
    install();
    ctl.apply();
    button('dock-left').click();
    assert.equal(panel.style.left, `${195 + 8}px`);
    const watcher = observers.at(-1);
    assert.notEqual(watcher, observers[0], 'the rails have their own watcher');
    // Data Layers opens: the rail is now 280 px wider.
    railRect = { left: 52, top: 234, width: 423, height: 500 };
    watcher.fire();
    mock.timers.tick(150);
    assert.equal(panel.style.left, `${475 + 8}px`);
    // Floating again: the rails are not followed any more.
    button('float').click();
    railRect = { left: 52, top: 234, width: 143, height: 110 };
    watcher.fire();
    mock.timers.tick(150);
    assert.ok(panel.classList.contains('gev-win-float'));
  } finally {
    stack.remove();
  }
});

/* ---------------- what must stay in view (rects from the app) ------------ */

/*
 * Rects measured in the running app at 1280x720 and 375x812 (Data Layers
 * open where said). Each entry: [selector-ish, rect, parent?].
 */
const rectOf = ({ left, top, right, bottom }) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
});

/** Mount stand-ins for the app's controls with these rects; returns cleanup. */
function stage(parts) {
  const made = [];
  const byName = new Map();
  for (const [name, box, parentName] of parts) {
    const el = document.createElement('div');
    if (name.startsWith('#')) el.id = name.slice(1);
    else if (name.startsWith('.')) el.className = name.slice(1);
    const rect = rectOf(box);
    el.getBoundingClientRect = () => rect;
    (byName.get(parentName) ?? document.body).appendChild(el);
    byName.set(name, el);
    made.push(el);
  }
  return {
    get: (name) => byName.get(name),
    remove: () => made.reverse().forEach((el) => el.remove()),
  };
}

const zero = { left: 0, top: 0, right: 0, bottom: 0 };
const DESK = { w: 1280, h: 720 };
/** The Cape May Dispatch page at 1280x720, as measured. */
const DESK_PARTS = [
  ['#top-center-actions', { left: 468, top: 32, right: 812, bottom: 68 }],
  ['#gev-county-ticker', { left: 223, top: 100, right: 1057, bottom: 130 }],
  ['#left-panel-stack', { left: 100, top: 188, right: 460, bottom: 543 }],
  [
    '.rail-left',
    { left: 52, top: 188, right: 94, bottom: 298 },
    '#left-panel-stack',
  ],
  [
    '#data-panel',
    { left: 100, top: 188, right: 380, bottom: 543 },
    '#left-panel-stack',
  ],
  ['#right-context-rail', { left: 850, top: 188, right: 1180, bottom: 188 }],
  [
    '.rail-right',
    { left: 1079, top: 188, right: 1228, bottom: 332 },
    '#right-context-rail',
  ],
  ['#cesium-credits', { left: 24, top: 626, right: 24, bottom: 626 }],
  [
    '.cesium-widget-credits',
    { left: 24, top: 598, right: 363, bottom: 626 },
    '#cesium-credits',
  ],
  ['.hud-bottom-left', { left: 36, top: 552, right: 338, bottom: 602 }],
  ['.hud-bottom-right', { left: 952, top: 525, right: 1244, bottom: 602 }],
  ['#cape-dispatch-panel', { left: 12, top: 631, right: 188, bottom: 664 }],
  ['#command-dock', { left: 403, top: 644, right: 877, bottom: 706 }],
  [
    '#location-bar',
    { left: 403, top: 644, right: 552, bottom: 706 },
    '#command-dock',
  ],
  [
    '#gev-voice-control',
    { left: 552, top: 628, right: 728, bottom: 714 },
    '#command-dock',
  ],
  [
    '#control-panel',
    { left: 728, top: 644, right: 877, bottom: 706 },
    '#command-dock',
  ],
  ['#corner-actions', { left: 956, top: 674, right: 1266, bottom: 706 }],
];
/** What nothing the windows place by themselves may cover. */
const KEEP_IN_VIEW = [
  '.cesium-widget-credits',
  '.hud-bottom-left',
  '.hud-bottom-right',
  '#cape-dispatch-panel',
  '#command-dock',
  '#location-bar',
  '#gev-voice-control',
  '#control-panel',
  '#corner-actions',
];
const overlaps = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function assertClear(box, scene, names, what) {
  for (const name of names) {
    const rect = scene.get(name).getBoundingClientRect();
    assert.ok(
      !overlaps(box, rect),
      `${what} ${JSON.stringify(box)} covers ${name} ${JSON.stringify(rect)}`,
    );
  }
}

test('bottomObstacles finds the credit line inside its zero-size box', () => {
  const scene = stage(DESK_PARTS);
  try {
    const tops = bottomObstacles(document, DESK).map((rect) => rect.top);
    // Credits (598, from the child), readouts, HOME, the dock and its
    // controls, the corner buttons; nothing from the top half.
    assert.deepEqual(
      [...tops].sort((a, b) => a - b),
      [525, 552, 598, 628, 631, 644, 644, 644, 674],
    );
  } finally {
    scene.remove();
  }
});

test('the HUD’s usual spot is over open map: by the location bar, above the dock, clear of the credits', () => {
  const scene = stage(DESK_PARTS);
  try {
    const anchor = hudAnchor(document, DESK, { w: 340, h: 220 });
    // Its left edge with the location bar; its bottom 8 px above the voice
    // control, the highest of the dock's controls.
    assert.deepEqual(anchor, { left: 403, bottom: 720 - 620, maxHeight: 330 });
    // At its tallest it still covers none of them, nor the open Data Layers
    // panel, nor the ticker.
    const box = {
      left: anchor.left,
      right: anchor.left + 340,
      bottom: 720 - anchor.bottom,
      top: 720 - anchor.bottom - anchor.maxHeight,
    };
    assertClear(
      box,
      scene,
      [...KEEP_IN_VIEW, '#data-panel', '#gev-county-ticker'],
      'HUD',
    );
  } finally {
    scene.remove();
  }
});

test('without the location bar the HUD rises above the credits and the readout under it', () => {
  const scene = stage(
    DESK_PARTS.filter(
      ([name, , parent]) =>
        name !== '#command-dock' && parent !== '#command-dock',
    ),
  );
  try {
    const anchor = hudAnchor(document, DESK, { w: 340, h: 220 });
    assert.equal(anchor.left, 52);
    // Above the MGRS readout (552), the highest thing under its columns.
    assert.equal(anchor.bottom, 720 - 544);
    const box = {
      left: anchor.left,
      right: anchor.left + 340,
      bottom: 720 - anchor.bottom,
      top: 720 - anchor.bottom - anchor.maxHeight,
    };
    assertClear(
      box,
      scene,
      ['.cesium-widget-credits', '.hud-bottom-left', '#cape-dispatch-panel'],
      'HUD',
    );
    // Its top stays under the ticker.
    assert.ok(box.top >= 130 + 8);
  } finally {
    scene.remove();
  }
  // Nothing at all on the page: the fallback spot.
  assert.deepEqual(hudAnchor(document, DESK), {
    left: 16,
    bottom: 96,
    maxHeight: 330,
  });
});

test('docked columns end above what must stay in view on their side', () => {
  const scene = stage(DESK_PARTS);
  try {
    const bounds = measureDockBounds(document, DESK);
    const box = (rect) => ({
      left: rect.left,
      right: rect.left + rect.width,
      top: rect.top,
      bottom: rect.top + rect.height,
    });
    // Left, beside the open Data Layers panel: above the dock.
    const left = dockRect({ side: 'left', viewport: DESK, ...bounds });
    assert.deepEqual(
      { left: left.left, top: left.top, height: left.height },
      { left: 388, top: 138, height: 620 - 138 },
    );
    assertClear(
      box(left),
      scene,
      [...KEEP_IN_VIEW, '#data-panel'],
      'dock-left',
    );
    // Right, beside the right rail: above the ALT/SUN readout.
    const right = dockRect({ side: 'right', viewport: DESK, ...bounds });
    assert.deepEqual(
      { left: right.left, top: right.top, height: right.height },
      { left: 1079 - 8 - 380, top: 138, height: 517 - 138 },
    );
    assertClear(
      box(right),
      scene,
      [...KEEP_IN_VIEW, '.rail-right'],
      'dock-right',
    );
    // Every width the inner edge allows stays clear too.
    for (const width of [300, 450, 560]) {
      for (const side of ['left', 'right'])
        assertClear(
          box(dockRect({ side, viewport: DESK, width, ...bounds })),
          scene,
          KEEP_IN_VIEW,
          `dock-${side} at ${width}`,
        );
    }
    // Data Layers closed: the left column moves beside the rail and ends
    // above the MGRS readout and the credits.
    scene.get('#data-panel').getBoundingClientRect = () => rectOf(zero);
    const closed = dockRect({
      side: 'left',
      viewport: DESK,
      ...measureDockBounds(document, DESK),
    });
    assert.equal(closed.left, 94 + 8);
    assert.equal(closed.top + closed.height, 552 - 8);
    assertClear(box(closed), scene, KEEP_IN_VIEW, 'dock-left, panel closed');
  } finally {
    scene.remove();
  }
});

test('the phone strip sits above every bottom control shown', () => {
  const PHONE = { w: 375, h: 812 };
  const scene = stage([
    ['#cesium-credits', { left: 10, top: 648, right: 365, bottom: 648 }],
    [
      '.cesium-widget-credits',
      { left: 10, top: 626, right: 281, bottom: 648 },
      '#cesium-credits',
    ],
    ['#command-dock', { left: 0, top: 658, right: 375, bottom: 744 }],
    [
      '#gev-voice-control',
      { left: 48, top: 658, right: 328, bottom: 744 },
      '#command-dock',
    ],
    ['#cape-dispatch-panel', { left: 12, top: 723, right: 188, bottom: 756 }],
    ['#mobile-tab-bar', { left: 0, top: 754, right: 375, bottom: 812 }],
    // The corner buttons sit at the top on a phone: not in the way.
    ['#corner-actions', { left: 330, top: 60, right: 363, bottom: 130 }],
  ]);
  try {
    const bottom = phoneHudBottom(document, PHONE);
    assert.equal(bottom, 812 - 626 + 6);
    // A 100 px strip there covers none of them.
    const strip = {
      left: 8,
      right: 367,
      bottom: 812 - bottom,
      top: 812 - bottom - 100,
    };
    assertClear(
      strip,
      scene,
      [
        '.cesium-widget-credits',
        '#gev-voice-control',
        '#cape-dispatch-panel',
        '#mobile-tab-bar',
      ],
      'strip',
    );
    // Credits and voice dock gone (clean view): just above the tab bar.
    scene.get('.cesium-widget-credits').getBoundingClientRect = () =>
      rectOf(zero);
    scene.get('#command-dock').getBoundingClientRect = () => rectOf(zero);
    scene.get('#gev-voice-control').getBoundingClientRect = () => rectOf(zero);
    assert.equal(phoneHudBottom(document, PHONE), 812 - 723 + 6);
  } finally {
    scene.remove();
  }
  assert.equal(phoneHudBottom(document, PHONE), null);
});

test('the centered panel at its usual size ends above the credits and readout', () => {
  const scene = stage(DESK_PARTS);
  try {
    // 620 px wide in the middle of 1280: over the MGRS readout's right end.
    const height = floatDefaultHeight(document, DESK);
    assert.equal(height, 552 - 8 - 96);
    const box = { left: 330, right: 950, top: 96, bottom: 96 + height };
    assertClear(box, scene, KEEP_IN_VIEW, 'floating panel');
    // Applied to the panel itself, unless the user sized or moved it.
    window.happyDOM.setViewport({ width: 1280, height: 720 });
    install();
    panel.hidden = false;
    ctl.apply();
    assert.equal(panel.style.height, `${height}px`);
    ctl.destroy();
    panel.removeAttribute('style');
    storage = memoryStorage({
      initial: JSON.stringify({ float: { x: null, y: null, w: 620, h: 500 } }),
    });
    install();
    ctl.apply();
    assert.equal(panel.style.height, '500px');
  } finally {
    scene.remove();
  }
  // Nothing below it: the CSS default stands.
  assert.equal(floatDefaultHeight(document, { w: 1920, h: 1080 }), null);
});

test('a window at rest moves up off the credits and readouts under it', () => {
  const scene = stage(DESK_PARTS);
  try {
    const size = { w: 340, h: 120 };
    // Dropped over the credits and HOME, bottom-left: just above the MGRS
    // readout, the highest of them under its columns.
    const at = clearOfBottom(document, DESK, { x: 20, y: 590 }, size);
    assert.deepEqual(at, { x: 20, y: 552 - 8 - 120 });
    assertClear(
      { left: 20, right: 360, top: at.y, bottom: at.y + 120 },
      scene,
      KEEP_IN_VIEW,
      'HUD at rest',
    );
    // Over open map: unchanged.
    assert.deepEqual(clearOfBottom(document, DESK, { x: 500, y: 300 }, size), {
      x: 500,
      y: 300,
    });
    // Too tall to fit above them: left where it is.
    assert.deepEqual(
      clearOfBottom(document, DESK, { x: 20, y: 100 }, { w: 340, h: 600 }),
      { x: 20, y: 100 },
    );
  } finally {
    scene.remove();
  }
});
