/**
 * The Local panel's window: where it sits and how big it is. Four modes:
 *
 *   float       a window over the map, as it always was, now movable by its
 *               header and resizable from its corner
 *   dock-left   a full-height column at one side of the map, under the top
 *   dock-right  bar and above the bottom dock, beside that side's rail when
 *               there is room for it
 *   hud         shrunk to the events HUD (eventHud.js); the panel is closed
 *
 * Pure helpers (clamping, the stored layout, the dock rectangle, what must
 * stay in view at the bottom of the map), a drag and arrow-key installer
 * shared with the HUD, and createPanelWindow, which wires them to the panel.
 * On phones (<= 720 px) the panel stays a bottom sheet: no drag, no dock;
 * only "Shrink to HUD" is offered.
 *
 * Nothing the windows place by themselves (a docked column, the HUD's usual
 * spot, the phone strip) covers the map credits (a licence term of the
 * imagery and Cesium), the MGRS / lat-lon readout, the CAPE MAY DISPATCH /
 * HOME box, the bottom command dock or, on phones, the tab bar: those are
 * measured on the page each time (bottomObstacles).
 *
 * The layout lives in localStorage under 'gev:local-window:v1' as
 * {mode, float: {x, y, w, h}, dockWidth, hud: {open, x, y, expandedFrom}}.
 * Every read and write is guarded; a missing or corrupt value reads as the
 * default layout, and stored positions and sizes are fitted to the screen
 * they are read on. Only during a drag may a window hang off the screen,
 * and never past its left edge, where its handles are.
 *
 * English-only, like the Local panel.
 */

export const WINDOW_STORAGE_KEY = 'gev:local-window:v1';
/** The modes the panel itself can show in. */
export const PANEL_MODES = Object.freeze(['float', 'dock-left', 'dock-right']);
export const WINDOW_MODES = Object.freeze([...PANEL_MODES, 'hud']);
/** A floating panel is never smaller than this (CSS min-width/height too). */
export const FLOAT_MIN = Object.freeze({ w: 320, h: 280 });
/** The CSS default size of the floating panel, for clamping before it shows. */
export const FLOAT_DEFAULT = Object.freeze({ w: 620, h: 640 });
export const DOCK_WIDTH = Object.freeze({ min: 300, max: 560, initial: 380 });
/** The HUD's usual size, for clamping before it shows. */
export const HUD_SIZE = Object.freeze({ w: 340, h: 220 });
/** During a drag, at least this much of a window stays on screen. */
export const KEEP_VISIBLE = 64;
/** Arrow keys move a window this far; with Shift, MOVE_STEP_LARGE. */
export const MOVE_STEP = 16;
export const MOVE_STEP_LARGE = 64;

/** Space kept from the screen edge, and between neighbours. */
const GUTTER = 12;
const GAP = 8;
/** The CSS keeps a floating panel this much smaller than the screen. */
const FLOAT_MARGIN = 16;
/** Where a docked panel ends when the top bar or bottom dock is not found. */
const FALLBACK_TOP = 96;
const FALLBACK_BOTTOM = 96;
/** A docked column is never shorter than this, obstacles or not. */
const DOCK_MIN_HEIGHT = 200;
/** The HUD's own height limit (local.css), and the least it is given. */
const HUD_MAX_HEIGHT = 330;
const HUD_MIN_HEIGHT = 120;
/** A stored number beyond this is not a real position or size. */
const MAX_STORED = 20_000;
/** A resize is saved once the corner has been still this long. */
const SAVE_DELAY_MS = 250;
/** A docked column follows a rail that changed size after this long. */
const RAIL_SETTLE_MS = 120;
/** A press has to move this far before it counts as a drag. */
const DRAG_THRESHOLD = 3;
/**
 * The click that ends a drag lands on the header too; a second click this
 * soon after is not a double-click that re-centers the window.
 */
const DRAG_DOUBLE_CLICK_GUARD_MS = 500;
/** Presses here click, select or type; they never start a drag. */
const NO_DRAG =
  'button, a, input, select, textarea, label, summary, [contenteditable], [role="tab"]';

/** Elements measured at run time (the ids and classes are the app's own). */
// The NWS alert chip, when shown, sits in the row a docked column would
// start in, so a column starts below it.
const TOP_BAR =
  '#top-center-actions, #gev-county-ticker, #gev-local-alert-chip:not([hidden])';
/** The bottom dock and its controls (location, voice and chat, presets). */
const DOCK_CONTROLS =
  '#command-dock, #command-dock > *, #gev-voice-control, #location-bar';
const LOCATION_BAR = '#location-bar';
const LEFT_RAIL = '#left-panel-stack > *';
const RIGHT_RAIL = '#right-context-rail > *';
/**
 * What must stay in view along the bottom of the map: the map credits
 * (#cesium-credits is a zero-size box; its children carry the line), the
 * MGRS / lat-lon readout and its twin on the right, the CAPE MAY DISPATCH /
 * HOME box, the command dock, the corner buttons, the world timeline and,
 * on phones, the tab bar.
 */
export const KEEP_CLEAR = [
  '#cesium-credits',
  '#cesium-credits > *',
  '.hud-bottom-left',
  '.hud-bottom-right',
  '#cape-dispatch-panel',
  DOCK_CONTROLS,
  '#corner-actions',
  '#world-timeline',
  '#mobile-tab-bar',
].join(', ');

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
/** value kept within [lo, hi]; lo when the range is empty. */
const within = (value, lo, hi) =>
  hi < lo ? lo : Math.min(hi, Math.max(lo, value));
const sizeOf = (value) => (finite(value) && value > 0 ? value : 0);

/* ------------------------------- clamping -------------------------------- */

/**
 * A window position during a drag: it may hang off the right and the bottom
 * (at least `keep` px stay on screen) but never off the left or the top,
 * where its handles are.
 * @param {{x: number, y: number}} position top-left corner, px
 * @param {{w: number, h: number}} size
 * @param {{w: number, h: number}} viewport
 * @returns {{x: number, y: number}}
 */
export function clampPosition(position, size, viewport, keep = KEEP_VISIBLE) {
  const vw = finite(viewport?.w) ? viewport.w : 0;
  const vh = finite(viewport?.h) ? viewport.h : 0;
  const x = finite(position?.x) ? position.x : 0;
  const y = finite(position?.y) ? position.y : 0;
  return {
    x: Math.round(within(x, 0, vw - keep)),
    y: Math.round(within(y, 0, vh - keep)),
  };
}

/**
 * A window position at rest (restored, after a drag, an arrow key or a
 * resize of the browser window): the whole window on screen when it fits,
 * else its top-left corner, where its handles are.
 * @returns {{x: number, y: number}}
 */
export function containPosition(position, size, viewport) {
  const vw = finite(viewport?.w) ? viewport.w : 0;
  const vh = finite(viewport?.h) ? viewport.h : 0;
  const x = finite(position?.x) ? position.x : 0;
  const y = finite(position?.y) ? position.y : 0;
  return {
    x: Math.round(within(x, 0, Math.max(0, vw - sizeOf(size?.w)))),
    y: Math.round(within(y, 0, Math.max(0, vh - sizeOf(size?.h)))),
  };
}

/** The floating panel's size before it shows: its own, or the CSS default. */
export function floatSizeOf(float, viewport) {
  const vw = finite(viewport?.w) ? viewport.w : FLOAT_DEFAULT.w;
  const vh = finite(viewport?.h) ? viewport.h : FLOAT_DEFAULT.h;
  return {
    w: finite(float?.w) ? float.w : Math.min(FLOAT_DEFAULT.w, vw - 24),
    h: finite(float?.h) ? float.h : Math.min(FLOAT_DEFAULT.h, vh - 200),
  };
}

/* ------------------------------- the layout ------------------------------ */

export function defaultLayout() {
  return {
    mode: 'float',
    float: { x: null, y: null, w: null, h: null },
    dockWidth: DOCK_WIDTH.initial,
    hud: { open: false, x: null, y: null, expandedFrom: 'float' },
  };
}

const coordinate = (value) =>
  finite(value) && Math.abs(value) <= MAX_STORED ? Math.round(value) : null;
const dimension = (value, min) =>
  finite(value) && value >= min && value <= MAX_STORED
    ? Math.round(value)
    : null;
const dockWidthOf = (value) =>
  finite(value)
    ? Math.round(within(value, DOCK_WIDTH.min, DOCK_WIDTH.max))
    : DOCK_WIDTH.initial;

/** A point, or both coordinates null: never half a position. */
function pointOf(source) {
  const x = coordinate(source?.x);
  const y = coordinate(source?.y);
  return x === null || y === null ? { x: null, y: null } : { x, y };
}

/**
 * A stored layout (a JSON string or an object) made whole: unknown modes,
 * missing fields and nonsense numbers fall back to the defaults. The HUD is
 * open exactly when the mode is 'hud'. With a viewport, the stored positions
 * are clamped to it.
 * @param {unknown} raw
 * @param {{w: number, h: number}} [viewport]
 */
export function parseLayout(raw, viewport) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const layout = defaultLayout();
  if (!isObject(value)) return layout;
  const floatIn = isObject(value.float) ? value.float : {};
  const hudIn = isObject(value.hud) ? value.hud : {};
  const open = hudIn.open === true;
  let expandedFrom = PANEL_MODES.includes(hudIn.expandedFrom)
    ? hudIn.expandedFrom
    : 'float';
  // An open HUD with a panel mode stored: that is the mode it came from.
  if (open && PANEL_MODES.includes(value.mode)) expandedFrom = value.mode;
  layout.mode = open
    ? 'hud'
    : PANEL_MODES.includes(value.mode)
      ? value.mode
      : value.mode === 'hud'
        ? expandedFrom
        : 'float';
  layout.float = {
    ...pointOf(floatIn),
    w: dimension(floatIn.w, FLOAT_MIN.w),
    h: dimension(floatIn.h, FLOAT_MIN.h),
  };
  layout.dockWidth = dockWidthOf(value.dockWidth);
  layout.hud = { open, ...pointOf(hudIn), expandedFrom };
  return viewport ? clampLayout(layout, viewport) : layout;
}

/**
 * The stored layout fitted to this viewport: a floating size no bigger than
 * the screen allows (CSS max-width/height), and each stored position moved
 * so its whole window is on screen when it fits.
 */
export function clampLayout(layout, viewport) {
  const next = {
    ...layout,
    float: { ...layout.float },
    hud: { ...layout.hud },
  };
  const vw = finite(viewport?.w) ? viewport.w : null;
  const vh = finite(viewport?.h) ? viewport.h : null;
  const cap = (value, limit, min) =>
    value === null || limit === null
      ? value
      : Math.round(Math.max(min, Math.min(value, limit)));
  next.float.w = cap(
    next.float.w,
    vw === null ? null : vw - FLOAT_MARGIN,
    FLOAT_MIN.w,
  );
  next.float.h = cap(
    next.float.h,
    vh === null ? null : vh - FLOAT_MARGIN,
    FLOAT_MIN.h,
  );
  if (next.float.x !== null && next.float.y !== null)
    Object.assign(
      next.float,
      containPosition(next.float, floatSizeOf(next.float, viewport), viewport),
    );
  if (next.hud.x !== null && next.hud.y !== null)
    Object.assign(next.hud, containPosition(next.hud, HUD_SIZE, viewport));
  return next;
}

export function serializeLayout(layout) {
  const value = parseLayout(layout);
  return JSON.stringify({
    mode: value.mode,
    float: value.float,
    dockWidth: value.dockWidth,
    hud: value.hud,
  });
}

/** window.localStorage, or null where reading it throws (private modes). */
export function storageOf(win) {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored layout, or the default one; never throws. */
export function readLayout(storage, viewport) {
  let raw = null;
  try {
    raw = storage?.getItem?.(WINDOW_STORAGE_KEY) ?? null;
  } catch {
    raw = null;
  }
  return parseLayout(raw, viewport);
}

/** Store the layout; false when the browser refuses. Never throws. */
export function writeLayout(storage, layout) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(WINDOW_STORAGE_KEY, serializeLayout(layout));
    return true;
  } catch {
    return false;
  }
}

/** The mode the panel shows in when it opens (the HUD's own, when shrunk). */
export const panelModeOf = (layout) =>
  layout?.mode === 'hud'
    ? (layout.hud?.expandedFrom ?? 'float')
    : PANEL_MODES.includes(layout?.mode)
      ? layout.mode
      : 'float';

/**
 * The layout in another mode. Shrinking to 'hud' remembers the mode the
 * panel was in, so "Open Alerts" can expand back into it; any panel mode
 * closes the HUD.
 */
export function withMode(layout, mode) {
  const base = parseLayout(layout);
  if (mode === 'hud')
    return {
      ...base,
      mode: 'hud',
      hud: { ...base.hud, open: true, expandedFrom: panelModeOf(base) },
    };
  if (!PANEL_MODES.includes(mode)) return base;
  return { ...base, mode, hud: { ...base.hud, open: false } };
}

/** The HUD closed or expanded: the panel's own mode is back. */
export function leaveHud(layout) {
  const base = parseLayout(layout);
  return {
    ...base,
    mode: panelModeOf(base),
    hud: { ...base.hud, open: false },
  };
}

/* ------------------------------ measurement ------------------------------ */

function viewportOf(win, doc) {
  const w = win?.innerWidth || doc?.documentElement?.clientWidth || 1024;
  const h = win?.innerHeight || doc?.documentElement?.clientHeight || 768;
  return { w, h };
}

/** Rects of the matching elements that are shown and have a size. */
function shownRects(doc, selector) {
  let elements = [];
  try {
    elements = [...doc.querySelectorAll(selector)];
  } catch {
    return [];
  }
  const view = doc.defaultView;
  const rects = [];
  for (const element of elements) {
    const rect = element.getBoundingClientRect?.();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
    let style = null;
    try {
      style = view?.getComputedStyle?.(element) ?? null;
    } catch {
      style = null;
    }
    if (
      style &&
      (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0')
    )
      continue;
    rects.push(rect);
  }
  return rects;
}

const lowest = (values) => (values.length ? Math.min(...values) : null);
const highest = (values) => (values.length ? Math.max(...values) : null);
/** Whether a rect reaches into the columns [left, right). */
const acrossX = (rect, left, right) => rect.left < right && rect.right > left;

/**
 * What must stay in view along the bottom of the map (KEEP_CLEAR), as the
 * rects of those shown in the lower half of the screen.
 */
export function bottomObstacles(doc, viewport) {
  const vh = finite(viewport?.h) ? viewport.h : 768;
  return shownRects(doc, KEEP_CLEAR).filter(
    (rect) => rect.top > vh / 2 && rect.top < vh,
  );
}

/** The lowest edge of the top bar (globe actions, county ticker), or null. */
function topBarBottom(doc, viewport) {
  return highest(
    shownRects(doc, TOP_BAR)
      .filter((rect) => rect.top < viewport.h / 3)
      .map((rect) => rect.bottom),
  );
}

/** The top of the bottom dock's highest control, or null. */
function dockTop(doc, viewport) {
  return lowest(
    shownRects(doc, DOCK_CONTROLS)
      .filter((rect) => rect.bottom > (viewport.h * 2) / 3)
      .map((rect) => rect.top),
  );
}

/**
 * What a docked panel has to fit between, measured on the page: the bottom
 * of the top bar (globe actions and the county ticker), the top of the bottom
 * dock's highest control, the inner edges of the left and right rails (their
 * buttons and open panels), and what must stay in view below it. null for
 * anything not found or not shown.
 */
export function measureDockBounds(doc, viewport) {
  const { w: vw } = viewport;
  return {
    top: topBarBottom(doc, viewport),
    bottom: dockTop(doc, viewport),
    leftEdge: highest(
      shownRects(doc, LEFT_RAIL)
        .filter((rect) => rect.left < vw / 2)
        .map((rect) => rect.right),
    ),
    rightEdge: lowest(
      shownRects(doc, RIGHT_RAIL)
        .filter((rect) => rect.right > vw / 2)
        .map((rect) => rect.left),
    ),
    obstacles: bottomObstacles(doc, viewport),
  };
}

/**
 * Where a docked panel goes. It runs from under the top bar to above the
 * bottom dock (96 px from either edge when those are not found), and ends
 * above anything that must stay in view below the columns it can reach at
 * its widest (the map credits and the MGRS readout on the left, the readout
 * and corner buttons on the right). It sits beside the rail on its side when
 * the column fits between that rail and the other side's rail; otherwise it
 * covers the rail at the screen edge, and the rail is reachable again once
 * the panel is closed or shrunk.
 * @param {{side: 'left'|'right', viewport: {w: number, h: number},
 *   top?: number|null, bottom?: number|null, leftEdge?: number|null,
 *   rightEdge?: number|null, width?: number,
 *   obstacles?: {left: number, right: number, top: number}[]}} input
 * @returns {{side: string, left: number, right: number, top: number,
 *   width: number, height: number, beside: boolean}}
 */
export function dockRect({
  side = 'right',
  viewport,
  top = null,
  bottom = null,
  leftEdge = null,
  rightEdge = null,
  width = DOCK_WIDTH.initial,
  obstacles = [],
} = {}) {
  const vw = finite(viewport?.w) ? viewport.w : 1024;
  const vh = finite(viewport?.h) ? viewport.h : 768;
  const onRight = side !== 'left';
  const widest = Math.min(DOCK_WIDTH.max, vw - 2 * GUTTER);
  const w = Math.round(
    within(finite(width) ? width : DOCK_WIDTH.initial, DOCK_WIDTH.min, widest),
  );
  const y = Math.round(finite(top) ? top + GAP : FALLBACK_TOP);
  const near = onRight ? rightEdge : leftEdge;
  const far = onRight ? leftEdge : rightEdge;
  let x = onRight ? vw - GUTTER - w : GUTTER;
  let beside = false;
  if (finite(near)) {
    const candidate = onRight ? near - GAP - w : near + GAP;
    const fits = onRight
      ? candidate >= (finite(far) ? far + GAP : GUTTER)
      : candidate + w <= (finite(far) ? far - GAP : vw - GUTTER);
    if (fits) {
      x = candidate;
      beside = true;
    }
  }
  x = Math.round(x);
  // The columns the panel covers at its widest: anchored on its own side,
  // a wider column grows toward the map.
  const [from, to] = onRight ? [x + w - widest, x + w] : [x, x + widest];
  let end = finite(bottom) ? bottom - GAP : vh - FALLBACK_BOTTOM;
  for (const rect of Array.isArray(obstacles) ? obstacles : [])
    if (finite(rect?.top) && acrossX(rect, from, to))
      end = Math.min(end, rect.top - GAP);
  const height = Math.round(
    Math.max(Math.min(DOCK_MIN_HEIGHT, vh - y - GUTTER), end - y),
  );
  return {
    side: onRight ? 'right' : 'left',
    left: x,
    right: Math.round(vw - x - w),
    top: y,
    width: w,
    height,
    beside,
  };
}

/**
 * The HUD's usual spot, over open map: its left edge with the location bar
 * (else the bottom dock, else the left rail, else 16 px in) and its bottom
 * 8 px above the highest of the bottom dock's controls (96 px up when there
 * is no dock), and higher still where something that must stay in view (the
 * credits, the MGRS readout, HOME) sits below its columns. maxHeight keeps
 * its top under the top bar.
 * @param {{w: number, h: number}} [size] the HUD's size (its width matters)
 * @returns {{left: number, bottom: number, maxHeight: number}}
 */
export function hudAnchor(doc, viewport, size = HUD_SIZE) {
  const { w: vw, h: vh } = viewport;
  const width = Math.min(sizeOf(size?.w) || HUD_SIZE.w, vw - 2 * GUTTER);
  const lowerThird = (rect) => rect.bottom > (vh * 2) / 3;
  const bar = shownRects(doc, LOCATION_BAR).filter(lowerThird);
  const dock = shownRects(doc, DOCK_CONTROLS).filter(lowerThird);
  const rail = shownRects(doc, LEFT_RAIL)
    .filter((rect) => rect.left < vw / 2)
    .map((rect) => rect.left);
  const left = Math.round(
    within(
      bar.length
        ? lowest(bar.map((rect) => rect.left))
        : dock.length
          ? lowest(dock.map((rect) => rect.left))
          : rail.length
            ? Math.max(GUTTER, lowest(rail))
            : 16,
      GUTTER,
      vw - GUTTER - width,
    ),
  );
  const top = dockTop(doc, viewport);
  let floor = top === null ? vh - FALLBACK_BOTTOM : top - GAP;
  for (const rect of bottomObstacles(doc, viewport))
    if (acrossX(rect, left, left + width))
      floor = Math.min(floor, rect.top - GAP);
  const ceiling = (topBarBottom(doc, viewport) ?? FALLBACK_TOP - GAP) + GAP;
  return {
    left,
    bottom: Math.round(Math.max(GUTTER, vh - floor)),
    maxHeight: Math.round(
      within(floor - ceiling, HUD_MIN_HEIGHT, HUD_MAX_HEIGHT),
    ),
  };
}

/**
 * A window at rest (the HUD dropped or nudged) moved up just enough that it
 * covers nothing that must stay in view under its columns (the credits, the
 * MGRS readout, HOME, the dock), when there is room above; else unchanged.
 * @param {{x: number, y: number}} position its top-left corner
 * @param {{w: number, h: number}} size
 * @returns {{x: number, y: number}}
 */
export function clearOfBottom(doc, viewport, position, size) {
  const w = sizeOf(size?.w);
  const h = sizeOf(size?.h);
  let floor = Infinity;
  for (const rect of bottomObstacles(doc, viewport))
    if (acrossX(rect, position.x, position.x + w))
      floor = Math.min(floor, rect.top - GAP);
  if (!(position.y + h > floor) || floor - h < 0) return position;
  return { x: position.x, y: Math.round(floor - h) };
}

/** Where the centered floating panel's top is (local.css #gev-local-main). */
const FLOAT_TOP = 96;

/**
 * The centered floating panel's height when the user has not sized it: the
 * CSS default (640 px, or the screen less 200 px), shortened so its bottom
 * stays above what must stay in view under its columns (on a 1280x720
 * screen, the map credits and the MGRS readout). null: the CSS default fits.
 * @param {number} [width] its width (the CSS default when not given)
 * @returns {number|null}
 */
export function floatDefaultHeight(doc, viewport, width) {
  const { w: vw, h: vh } = viewport;
  const w = finite(width) ? width : Math.min(FLOAT_DEFAULT.w, vw - 24);
  const css = Math.min(FLOAT_DEFAULT.h, vh - 200);
  const left = (vw - w) / 2;
  let floor = Infinity;
  for (const rect of bottomObstacles(doc, viewport))
    if (acrossX(rect, left, left + w)) floor = Math.min(floor, rect.top - GAP);
  const fits = Math.round(Math.max(FLOAT_MIN.h, floor - FLOAT_TOP));
  return fits < css ? fits : null;
}

/**
 * Phones: how far up the HUD strip sits so it clears every bottom control
 * shown (the tab bar, the voice and chat dock, HOME, the credit line), 6 px
 * above the highest; null when none is shown (CSS then falls back to the
 * tab bar's own height variable).
 */
export function phoneHudBottom(doc, viewport) {
  const top = lowest(bottomObstacles(doc, viewport).map((rect) => rect.top));
  return top === null ? null : Math.round(Math.max(0, viewport.h - top + 6));
}

/* ----------------------------- drag and keys ----------------------------- */

const ARROWS = Object.freeze({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
});

/** A mouse that moves with no button down has finished its drag elsewhere. */
const releasedMouse = (event) =>
  event.pointerType === 'mouse' && event.buttons === 0;
/** Only the main button of the main pointer drags. */
const mainPress = (event) =>
  event.isPrimary !== false &&
  !(event.pointerType === 'mouse' && event.button !== 0);

/**
 * Wire a window's drag and keyboard move. A press on `area` that moves more
 * than 3 px drags (pointer capture keeps the moves coming); presses on
 * buttons, links and fields never start one. A drag ends on pointerup or
 * pointercancel, when the pointer capture is lost (the window was hidden
 * mid-drag) or when a mouse moves with no button down (its pointerup landed
 * elsewhere), so it can never stay stuck to the cursor. Arrow keys on
 * `keyHandle` move by 16 px, 64 px with Shift; Enter or Space on it calls
 * onActivate. A double click on `area` calls onDoubleClick, except as the
 * second click right after a drag.
 * @param {{area: Element, keyHandle?: Element|null, enabled?: () => boolean,
 *   getRect: () => DOMRect, onStart?: Function, onMove: Function,
 *   onEnd?: Function, onKey?: (dx: number, dy: number) => void,
 *   onActivate?: Function|null, onDoubleClick?: Function,
 *   now?: () => number}} options
 * @returns {() => void} dispose
 */
export function installDrag({
  area,
  keyHandle = null,
  enabled = () => true,
  getRect,
  onStart = () => {},
  onMove,
  onEnd = () => {},
  onKey = () => {},
  onActivate = null,
  onDoubleClick = () => {},
  now = () => Date.now(),
}) {
  let drag = null;
  let draggedAt = -Infinity;
  const samePointer = (event) =>
    drag &&
    (drag.pointerId === undefined ||
      event.pointerId === undefined ||
      event.pointerId === drag.pointerId);

  /** End the drag in progress, whatever ended it. */
  function finish() {
    const done = drag;
    if (!done) return;
    drag = null;
    area.classList.remove('is-dragging');
    try {
      if (area.hasPointerCapture?.(done.pointerId))
        area.releasePointerCapture?.(done.pointerId);
    } catch {
      /* already released */
    }
    if (done.moving) {
      draggedAt = now();
      onEnd(done);
    }
  }

  const down = (event) => {
    if (drag || !enabled() || !mainPress(event)) return;
    if (event.target?.closest?.(NO_DRAG)) return;
    const rect = getRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - (rect?.left ?? 0),
      grabY: event.clientY - (rect?.top ?? 0),
      moving: false,
    };
    try {
      area.setPointerCapture?.(event.pointerId);
    } catch {
      /* moves still arrive while the pointer stays on the area */
    }
  };
  const move = (event) => {
    if (!samePointer(event)) return;
    if (releasedMouse(event)) {
      finish();
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moving = true;
      area.classList.add('is-dragging');
      onStart(drag);
    }
    event.preventDefault?.();
    onMove({ clientX: event.clientX, clientY: event.clientY, state: drag });
  };
  const up = (event) => {
    if (samePointer(event)) finish();
  };
  const doubleClick = (event) => {
    if (!enabled() || event.target?.closest?.(NO_DRAG)) return;
    if (now() - draggedAt < DRAG_DOUBLE_CLICK_GUARD_MS) return;
    onDoubleClick();
  };
  const key = (event) => {
    if (!enabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (onActivate && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onActivate();
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
    onKey(arrow[0] * step, arrow[1] * step);
  };

  area.addEventListener('pointerdown', down);
  area.addEventListener('pointermove', move);
  area.addEventListener('pointerup', up);
  area.addEventListener('pointercancel', up);
  area.addEventListener('lostpointercapture', up);
  area.addEventListener('dblclick', doubleClick);
  keyHandle?.addEventListener('keydown', key);
  return () => {
    area.removeEventListener('pointerdown', down);
    area.removeEventListener('pointermove', move);
    area.removeEventListener('pointerup', up);
    area.removeEventListener('pointercancel', up);
    area.removeEventListener('lostpointercapture', up);
    area.removeEventListener('dblclick', doubleClick);
    keyHandle?.removeEventListener('keydown', key);
    area.classList.remove('is-dragging');
    drag = null;
  };
}

/* ---------------------------- header controls ---------------------------- */

const svg = (body) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">${body}</svg>`;
const FRAME =
  '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/>';
const ICONS = Object.freeze({
  'dock-left': svg(
    `${FRAME}<rect x="2.5" y="3.5" width="4.5" height="9" fill="currentColor"/>`,
  ),
  'dock-right': svg(
    `${FRAME}<rect x="9" y="3.5" width="4.5" height="9" fill="currentColor"/>`,
  ),
  float: svg(
    '<rect x="1.5" y="5.5" width="9" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="5.5" y="2.5" width="9" height="8" rx="1.2" fill="currentColor" opacity="0.55"/>',
  ),
  hud: svg(
    `${FRAME}<rect x="2.5" y="9" width="7" height="3.5" fill="currentColor"/>`,
  ),
});

/** [mode, aria-label, title] for each header button, in order. */
// i18n-ignore: the Local panel is English-only county content.
const CONTROLS = Object.freeze([
  ['dock-left', 'Dock left', 'Dock left: a full-height column on the left'],
  ['dock-right', 'Dock right', 'Dock right: a full-height column on the right'],
  ['float', 'Float', 'Float over the map again'],
  ['hud', 'Shrink to HUD', 'Shrink to a small live events box (HUD)'],
]);

/**
 * The window buttons for the panel header (next to its × close). The dock
 * and float buttons say which mode is on (aria-pressed); "Shrink to HUD" is
 * an action, so it has no pressed state.
 */
export function windowControlsHtml() {
  // i18n-ignore: the Local panel is English-only county content.
  return `<span class="gev-win-controls" role="group" aria-label="Window position">${CONTROLS.map(
    ([mode, label, tip]) =>
      `<button type="button" class="gev-win-btn" data-win="${mode}" aria-label="${label}" title="${tip}"${mode === 'hud' ? '' : ' aria-pressed="false"'}>${ICONS[mode]}</button>`,
  ).join('')}</span>`;
}

/**
 * The panel's move grip, for the start of its title: the keyboard handle
 * that arrow keys move the window by (Enter or Space re-centers it). The
 * heading beside it stays a heading.
 */
export function windowGripHtml() {
  // i18n-ignore: the Local panel is English-only county content.
  return '<span class="gev-win-grip" role="button" tabindex="0" aria-label="Move window, use arrow keys" title="Drag the title bar to move · Enter or double-click to re-center">⠿</span>';
}

/* ------------------------------ the panel -------------------------------- */

const px = (value) => {
  const n = Number.parseFloat(value);
  return /px$/.test(String(value)) && Number.isFinite(n) ? Math.round(n) : null;
};

const BOX_PROPS = ['left', 'top', 'right', 'bottom', 'width', 'height'];
const MODE_CLASSES = [
  'gev-win-float',
  'gev-win-dock',
  'gev-win-dock-left',
  'gev-win-dock-right',
  'is-placed',
];

/** Whether an element is laid out (not hidden, by itself or the CSS). */
function rendered(element) {
  if (!element || element.hidden) return false;
  try {
    if (typeof element.checkVisibility === 'function')
      return element.checkVisibility();
    return element.getClientRects().length > 0;
  } catch {
    return true;
  }
}

/**
 * Wire the Local panel's window: the mode buttons in its header, the drag
 * on its header and arrow keys on its grip, double-click (or Enter on the
 * grip) to re-center, the resize corner (CSS resize; the size is remembered)
 * and an inner-edge grip that sizes a docked column. The layout is stored on
 * every change and fitted to the screen again when the browser window
 * changes size.
 *
 * @param {{panel: HTMLElement, header: HTMLElement, handle: HTMLElement,
 *   win?: Window, storage?: Storage|null, isPhone?: () => boolean,
 *   onShrink?: () => void, onChange?: (layout: object) => void}} options
 *   handle is the header's move grip (windowGripHtml): the focusable "Move
 *   window" handle. onShrink runs for "Shrink to HUD"; the caller closes the
 *   panel and shows the HUD.
 */
export function createPanelWindow({
  panel,
  header,
  handle,
  win = panel.ownerDocument.defaultView,
  storage = storageOf(win),
  isPhone = () => false,
  onShrink = () => {},
  onChange = () => {},
}) {
  const doc = panel.ownerDocument;
  const viewport = () => viewportOf(win, doc);
  // A phone keeps the sheet: a stored desktop size is not fitted to it.
  let layout = readLayout(storage, isPhone() ? undefined : viewport());
  /** The inline size this module set last; anything else is a user resize. */
  let applied = { width: '', height: '' };
  let saveTimer = null;
  let destroyed = false;
  const Observer = win?.ResizeObserver ?? globalThis.ResizeObserver;
  /** Watches the rails while docked, so an opened side panel is not hidden. */
  let railObserver = null;
  let railTimer = null;

  const edge = doc.createElement('div');
  edge.className = 'gev-win-edge';
  edge.setAttribute('aria-hidden', 'true');
  panel.appendChild(edge);

  const save = () => writeLayout(storage, layout);
  const changed = () => {
    paintControls();
    onChange(layout);
  };
  const shown = () => !panel.hidden;

  function paintControls() {
    const mode = panelModeOf(layout);
    for (const button of panel.querySelectorAll('[data-win]')) {
      const value = button.dataset.win;
      // "Shrink to HUD" is an action, not a state.
      if (value === 'hud') {
        button.removeAttribute('aria-pressed');
        continue;
      }
      button.setAttribute('aria-pressed', String(mode === value));
      if (value === 'float') button.hidden = mode === 'float';
    }
  }

  /** The grip is shown, and focusable, only where the window moves. */
  function paintHandle() {
    if (handle) handle.hidden = isPhone();
  }

  function sizeNow() {
    const rect = panel.getBoundingClientRect();
    const fallback = floatSizeOf(layout.float, viewport());
    return {
      w: rect.width > 0 ? rect.width : fallback.w,
      h: rect.height > 0 ? rect.height : fallback.h,
    };
  }

  /** A size the user dragged with the resize corner, folded into the layout. */
  function captureUserSize() {
    if (destroyed || !shown() || isPhone()) return false;
    const width = panel.style.width;
    const height = panel.style.height;
    if (width === applied.width && height === applied.height) return false;
    applied = { width, height };
    const w = px(width);
    const h = px(height);
    if (panelModeOf(layout) === 'float')
      layout = {
        ...layout,
        float: {
          ...layout.float,
          w: w === null ? layout.float.w : Math.max(FLOAT_MIN.w, w),
          h: h === null ? layout.float.h : Math.max(FLOAT_MIN.h, h),
        },
      };
    else if (w !== null) layout = { ...layout, dockWidth: dockWidthOf(w) };
    save();
    return true;
  }

  /**
   * Put the floating panel at (x, y): during a drag it may hang off the
   * right or bottom; otherwise the whole panel stays on screen.
   */
  function place(x, y, { dragging = false } = {}) {
    const position = (dragging ? clampPosition : containPosition)(
      { x, y },
      sizeNow(),
      viewport(),
    );
    layout = { ...layout, float: { ...layout.float, ...position } };
    panel.classList.add('is-placed');
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
    return position;
  }

  /** Put the panel where its layout says. Called on open and on resize. */
  function apply() {
    if (destroyed) return;
    // A corner resize still settling is kept before the size is reset.
    captureUserSize();
    const style = panel.style;
    panel.classList.remove(...MODE_CLASSES);
    delete panel.dataset.beside;
    for (const prop of BOX_PROPS) style.removeProperty(prop);
    applied = { width: '', height: '' };
    paintHandle();
    paintControls();
    if (isPhone()) {
      // The bottom sheet of local.css; no window geometry at all.
      panel.dataset.window = 'sheet';
      return;
    }
    layout = clampLayout(layout, viewport());
    const mode = panelModeOf(layout);
    panel.dataset.window = mode;
    if (mode === 'float') {
      panel.classList.add('gev-win-float');
      const placed = layout.float.x !== null && layout.float.y !== null;
      if (layout.float.w) style.width = `${layout.float.w}px`;
      if (layout.float.h) style.height = `${layout.float.h}px`;
      else if (!placed) {
        // Centered at its usual size: kept clear of the credits below it.
        const fit = floatDefaultHeight(
          doc,
          viewport(),
          layout.float.w ?? undefined,
        );
        if (fit !== null) style.height = `${fit}px`;
      }
      if (placed) place(layout.float.x, layout.float.y);
    } else positionDock(mode);
    applied = { width: style.width, height: style.height };
    watchRails();
  }

  /**
   * The docked column between the top bar, the bottom dock and the rails,
   * ending above what must stay in view below it.
   */
  function positionDock(mode) {
    const style = panel.style;
    const rect = dockRect({
      side: mode === 'dock-left' ? 'left' : 'right',
      viewport: viewport(),
      width: layout.dockWidth,
      ...measureDockBounds(doc, viewport()),
    });
    panel.classList.add('gev-win-dock', `gev-win-dock-${rect.side}`);
    panel.dataset.beside = String(rect.beside);
    style.top = `${rect.top}px`;
    style.height = `${rect.height}px`;
    style.width = `${rect.width}px`;
    // Anchored on its own side, so a wider column grows toward the map.
    style.removeProperty(rect.side === 'left' ? 'right' : 'left');
    if (rect.side === 'left') style.left = `${rect.left}px`;
    else style.right = `${rect.right}px`;
  }

  /**
   * While docked, a side panel opening or closing in a rail (Data Layers,
   * Display…) moves the column beside it again instead of hiding it.
   */
  function watchRails() {
    railObserver?.disconnect();
    railObserver = null;
    clearTimeout(railTimer);
    if (
      typeof Observer !== 'function' ||
      !shown() ||
      isPhone() ||
      panelModeOf(layout) === 'float'
    )
      return;
    try {
      railObserver = new Observer(() => {
        clearTimeout(railTimer);
        railTimer = setTimeout(() => {
          const mode = panelModeOf(layout);
          if (destroyed || !shown() || isPhone() || mode === 'float') return;
          captureUserSize();
          positionDock(mode);
          applied = { width: panel.style.width, height: panel.style.height };
        }, RAIL_SETTLE_MS);
      });
      for (const element of doc.querySelectorAll(
        `${LEFT_RAIL}, ${RIGHT_RAIL}, ${KEEP_CLEAR}`,
      ))
        railObserver.observe(element);
    } catch {
      railObserver = null;
    }
  }

  function setMode(mode) {
    if (!WINDOW_MODES.includes(mode)) return layout;
    captureUserSize();
    layout = withMode(layout, mode);
    save();
    if (mode !== 'hud' && shown()) apply();
    changed();
    return layout;
  }

  /** A docked or centered panel becomes a placed floating one, where it is. */
  function undockInPlace() {
    const rect = panel.getBoundingClientRect();
    const docked = panelModeOf(layout) !== 'float';
    if (docked) {
      layout = withMode(layout, 'float');
      apply();
      changed();
    }
    if (docked || layout.float.x === null || layout.float.y === null)
      place(rect.left, rect.top);
  }

  function recenter() {
    captureUserSize();
    layout = withMode(layout, 'float');
    layout = { ...layout, float: { ...layout.float, x: null, y: null } };
    save();
    apply();
    changed();
  }

  const disposeDrag = installDrag({
    area: header,
    keyHandle: handle,
    enabled: () => shown() && !isPhone(),
    getRect: () => panel.getBoundingClientRect(),
    onStart: (state) => {
      captureUserSize();
      if (panelModeOf(layout) !== 'float') {
        // Dragging a docked column undocks it to float at the drop point.
        layout = withMode(layout, 'float');
        apply();
        const { w } = sizeNow();
        state.grabX = Math.min(
          state.grabX,
          Math.max(KEEP_VISIBLE, w - KEEP_VISIBLE),
        );
        changed();
      }
    },
    onMove: ({ clientX, clientY, state }) =>
      place(clientX - state.grabX, clientY - state.grabY, { dragging: true }),
    onEnd: () => {
      // At rest again: the whole panel back on screen.
      place(layout.float.x, layout.float.y);
      save();
      onChange(layout);
    },
    onKey: (dx, dy) => {
      captureUserSize();
      undockInPlace();
      place(layout.float.x + dx, layout.float.y + dy);
      save();
    },
    onActivate: recenter,
    onDoubleClick: recenter,
  });

  // The docked column's inner edge: drag it to make the column wider.
  let edgeDrag = null;
  const edgeUp = () => {
    const done = edgeDrag;
    if (!done) return;
    edgeDrag = null;
    edge.classList.remove('is-dragging');
    try {
      if (edge.hasPointerCapture?.(done.pointerId))
        edge.releasePointerCapture?.(done.pointerId);
    } catch {
      /* already released */
    }
    save();
  };
  const edgeDown = (event) => {
    if (edgeDrag || !mainPress(event)) return;
    if (!panel.classList.contains('gev-win-dock') || isPhone()) return;
    edgeDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startW: panel.getBoundingClientRect().width || layout.dockWidth,
    };
    edge.classList.add('is-dragging');
    try {
      edge.setPointerCapture?.(event.pointerId);
    } catch {
      /* moves still arrive while the pointer stays on the grip */
    }
    event.preventDefault?.();
  };
  const edgeMove = (event) => {
    if (!edgeDrag) return;
    if (
      edgeDrag.pointerId !== undefined &&
      event.pointerId !== undefined &&
      event.pointerId !== edgeDrag.pointerId
    )
      return;
    if (releasedMouse(event)) {
      edgeUp();
      return;
    }
    const dx = event.clientX - edgeDrag.startX;
    const grow = panel.classList.contains('gev-win-dock-right') ? -dx : dx;
    const width = Math.round(
      within(
        edgeDrag.startW + grow,
        DOCK_WIDTH.min,
        Math.min(DOCK_WIDTH.max, viewport().w - 2 * GUTTER),
      ),
    );
    panel.style.width = `${width}px`;
    applied = { ...applied, width: panel.style.width };
    layout = { ...layout, dockWidth: dockWidthOf(width) };
  };
  edge.addEventListener('pointerdown', edgeDown);
  edge.addEventListener('pointermove', edgeMove);
  edge.addEventListener('pointerup', edgeUp);
  edge.addEventListener('pointercancel', edgeUp);
  edge.addEventListener('lostpointercapture', edgeUp);

  const onClick = (event) => {
    const button = event.target?.closest?.('[data-win]');
    if (!button || !panel.contains(button)) return;
    const mode = button.dataset.win;
    if (mode === 'hud') {
      onShrink();
      return;
    }
    const before = panelModeOf(layout);
    // A pressed dock button floats the panel again.
    setMode(mode === before ? 'float' : mode);
    // A button that hid itself ("Float", once floating) hands the focus on,
    // to the dock button of the side just left (else the grip), so a
    // keyboard user is not dropped at the top of the page.
    const active = doc.activeElement;
    if (
      !rendered(button) &&
      (active === button || !active || active === doc.body)
    ) {
      const next = panel.querySelector(`[data-win="${before}"]`);
      (rendered(next) ? next : handle)?.focus?.({ preventScroll: true });
    }
  };
  panel.addEventListener('click', onClick);

  const onResize = () => {
    captureUserSize();
    if (isPhone()) {
      if (shown()) apply();
      return;
    }
    layout = clampLayout(layout, viewport());
    if (shown()) apply();
  };
  win?.addEventListener?.('resize', onResize);

  // The resize corner: the browser writes the new size inline.
  let observer = null;
  if (typeof Observer === 'function') {
    try {
      observer = new Observer(() => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(captureUserSize, SAVE_DELAY_MS);
      });
      observer.observe(panel);
    } catch {
      observer = null;
    }
  }

  paintHandle();
  paintControls();

  return {
    get layout() {
      return layout;
    },
    /** 'float', 'dock-left', 'dock-right' or 'hud'. */
    get mode() {
      return layout.mode;
    },
    /** The mode the panel opens in. */
    get panelMode() {
      return panelModeOf(layout);
    },
    get hudOpen() {
      return layout.mode === 'hud';
    },
    apply,
    setMode,
    recenter,
    /** "Open Alerts" or × on the HUD: the panel's own mode is back. */
    leaveHud() {
      if (layout.mode !== 'hud' && !layout.hud.open) return panelModeOf(layout);
      layout = leaveHud(layout);
      save();
      changed();
      return panelModeOf(layout);
    },
    setHudPosition(position) {
      layout = { ...layout, hud: { ...layout.hud, ...pointOf(position) } };
      save();
    },
    /** Fold a pending corner resize into the layout now (before closing). */
    flush() {
      clearTimeout(saveTimer);
      return captureUserSize();
    },
    destroy() {
      destroyed = true;
      clearTimeout(saveTimer);
      clearTimeout(railTimer);
      observer?.disconnect?.();
      railObserver?.disconnect?.();
      disposeDrag();
      edge.removeEventListener('pointerdown', edgeDown);
      edge.removeEventListener('pointermove', edgeMove);
      edge.removeEventListener('pointerup', edgeUp);
      edge.removeEventListener('pointercancel', edgeUp);
      edge.removeEventListener('lostpointercapture', edgeUp);
      panel.removeEventListener('click', onClick);
      win?.removeEventListener?.('resize', onResize);
      edge.remove();
    },
  };
}
