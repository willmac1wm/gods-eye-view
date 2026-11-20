import '../testSupport/registerDom.mjs';
import test, { afterEach, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ELSEWHERE } from '../ui/panelElsewhereLayers.js';
import { DASHBOARD_ITEMS } from './countyDashboard.js';
import {
  LOCAL_TAB_TOGGLES,
  closeLocalPanel,
  initLocalShell,
  openLocalPanel,
  toggleLocalPanel,
} from './shell.js';

/*
 * The Local panel mounted in a DOM with a fake globe and fake /api answers:
 * the Alerts tab's live events, the County dashboard and the "Show on map"
 * switches for the layers that left the Data Layers list.
 */

const MIN = 60_000;
const PHONE = '(max-width: 720px)';
const WINDOW_KEY = 'gev:local-window:v1';

/** A flushed microtask queue: fetch stubs and awaits all settle. */
async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i += 1)
    await new Promise((resolve) => setImmediate(resolve));
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function eventsBody(now = Date.now()) {
  return {
    generatedAt: now,
    summary: {
      at: now,
      lines: [
        {
          text: 'Coastal Flood Advisory until 10:00 PM',
          tone: 'watch',
          source: 'NWS',
          eventId: 'e-alert',
        },
        {
          text: '1 open: fire in Rio Grande',
          tone: 'warn',
          source: 'Fire Wire scanner',
          eventId: 'e-fire',
        },
      ],
    },
    sources: [
      { id: 'calls', name: 'Fire Wire scanner calls', ok: true, at: now },
      {
        id: 'aircraft',
        name: 'Coast Guard aircraft feed',
        ok: false,
        at: null,
      },
    ],
    events: [
      {
        id: 'e-fire',
        key: 'call:fw:1',
        kind: 'call',
        change: 'new',
        title: 'Fire reported',
        place: 'Rio Grande',
        detail: 'Structure fire · Middle Twp Fire',
        at: now - 10 * MIN,
        seenAt: now - 9 * MIN,
        lat: 39.0198,
        lon: -74.8771,
        layer: 'scanner-calls',
        severity: 'warn',
        source: 'Fire Wire scanner',
        threadId: 'e-fire',
        related: [{ id: 'e-road', reason: 'same road: Route 47' }],
      },
      {
        id: 'e-road',
        key: 'traffic:511nj:1',
        kind: 'traffic',
        change: 'new',
        title: 'Road closed',
        place: 'Route 47',
        detail: '',
        at: now - 20 * MIN,
        seenAt: now - 19 * MIN,
        lat: 39.02,
        lon: -74.88,
        layer: 'traffic-incidents',
        severity: 'watch',
        source: '511NJ',
        threadId: 'e-fire',
        related: [{ id: 'e-fire', reason: 'same road: Route 47' }],
      },
      {
        id: 'e-alert',
        key: 'alert:nws:1',
        kind: 'alert',
        change: 'new',
        title: 'Coastal Flood Advisory',
        place: 'Cape May County',
        detail: 'until 10:00 PM',
        at: now - 180 * MIN,
        seenAt: now - 179 * MIN,
        lat: null,
        lon: null,
        layer: 'nws-alerts',
        severity: 'watch',
        source: 'NWS',
        threadId: 'e-alert',
        related: [],
      },
      {
        id: 'e-xss',
        key: 'report:1',
        kind: 'report',
        change: 'new',
        title: '<img src=x onerror=alert(1)>',
        place: '"><script>alert(2)</script>',
        detail: '',
        at: now - 240 * MIN,
        seenAt: now - 239 * MIN,
        lat: null,
        lon: null,
        layer: null,
        severity: 'info',
        source: 'Community report',
        threadId: 'e-xss',
        related: [],
      },
    ],
  };
}

const NWS = {
  source: { name: 'National Weather Service (api.weather.gov)' },
  fetchedAt: new Date().toISOString(),
  status: 'live',
  note: null,
  features: [
    {
      id: 'nws:1',
      title: 'Coastal Flood Advisory',
      severity: 'Minor',
      areaDesc: 'Cape May; Atlantic Coastal Cape May',
      observedAt: new Date(Date.now() - 3 * 60 * MIN).toISOString(),
      expires: new Date(Date.now() + 5 * 60 * MIN).toISOString(),
      color: '#00ffff',
    },
  ],
};

const CONDITIONS = {
  disclaimer: 'Unofficial summary from public feeds. In an emergency call 911.',
  alerts: {
    status: 'live',
    source: 'NWS',
    updatedAgo: '2 min ago',
    active: [],
  },
  floodGauges: {
    status: 'live',
    source: 'NOAA',
    updatedAgo: '5 min ago',
    reporting: 3,
    atOrAboveFloodStage: [],
    tideStations: [],
  },
  predictedFlooding: {
    status: 'estimated',
    source: 'NOAA',
    anchors: [],
    note: 'No flooding predicted.',
  },
  powerOutages: {
    status: 'live',
    source: 'ACE',
    updatedAgo: '3 min ago',
    byCounty: [],
  },
  trafficIncidents: {
    status: 'live',
    source: '511NJ',
    updatedAgo: '1 min ago',
    count: 0,
  },
  marine: {
    status: 'live',
    source: 'NDBC',
    updatedAgo: '9 min ago',
    stations: [],
  },
  airports: {
    status: 'live',
    source: 'AWC',
    updatedAgo: '4 min ago',
    local: [],
  },
  radar: { note: 'See the rain radar layer.' },
};

const feed = (name) => ({
  source: { name },
  fetchedAt: new Date().toISOString(),
  status: 'live',
  note: null,
  features: [],
});

/** Answers by path; anything else is a 404. `hold` keeps a path pending. */
function installFetch(overrides = {}) {
  const log = [];
  const held = new Map();
  const routes = {
    '/api/local/events': () => json(eventsBody()),
    '/api/local/nws-alerts': () => json(NWS),
    '/api/local/conditions': () => json(CONDITIONS),
    '/api/local/local-news': () => json(feed('Local news')),
    '/api/local/airport-radio': () => json(feed('Airport radio')),
    '/api/local/public-safety-calls': () => json(feed('Fire Wire scanner')),
    ...overrides,
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    log.push(url);
    const path = url.split('?')[0];
    if (held.has(path))
      await new Promise((resolve) => held.get(path).push(resolve));
    const route = routes[path];
    return route ? route(url) : json({}, 404);
  };
  return {
    log,
    routes,
    hold: (path) => held.set(path, []),
    release(path) {
      const waiting = held.get(path) || [];
      held.delete(path);
      waiting.forEach((resolve) => resolve());
    },
  };
}

function fakeViewer() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const flights = [];
  return {
    flights,
    scene: { canvas, pick: () => null, globe: {} },
    camera: { flyTo: (options) => flights.push(options) },
  };
}

function fakeDataManager() {
  const on = new Set();
  const calls = [];
  return {
    on,
    calls,
    isEnabled: (id) => on.has(id),
    setEnabled: async (id, enabled, options) => {
      calls.push([id, enabled, options?.origin]);
      if (enabled) on.add(id);
      else on.delete(id);
    },
  };
}

function phoneScreen(matches) {
  window.matchMedia = (query) => ({
    matches: matches && query === PHONE,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

const panelEl = () => document.getElementById('gev-local-main');
const bodyEl = () => panelEl().querySelector('.gev-local-body');
const layersShown = () =>
  [...bodyEl().querySelectorAll('[data-act="layer"]')].map(
    (el) => el.dataset.layer,
  );
async function openTab(tab) {
  openLocalPanel(tab);
  await flush();
}

let net;
let viewer;
let dm;
let destroy;
const realMatchMedia = window.matchMedia;

beforeEach(async () => {
  localStorage.removeItem(WINDOW_KEY);
  phoneScreen(false);
  net = installFetch();
  viewer = fakeViewer();
  dm = fakeDataManager();
  destroy = initLocalShell({ viewer, dataManager: dm });
  await flush();
});

afterEach(() => {
  destroy?.();
  destroy = null;
  closeLocalPanel();
  viewer.scene.canvas.remove();
  window.matchMedia = realMatchMedia;
  mock.timers.reset();
  localStorage.removeItem(WINDOW_KEY);
});

// ------------------------------------------------------------- Alerts tab

test('the Alerts tab reads events and NWS together, then draws crawl, Right now, timeline and NWS', async () => {
  net.hold('/api/local/events');
  net.hold('/api/local/nws-alerts');
  net.log.length = 0;
  openLocalPanel('alerts');
  await flush();
  // Both reads are out before either answers.
  assert.ok(net.log.includes('/api/local/events'));
  assert.ok(net.log.includes('/api/local/nws-alerts'));
  assert.match(bodyEl().textContent, /Loading live events and NWS alerts/);
  net.release('/api/local/events');
  net.release('/api/local/nws-alerts');
  await flush();
  const html = bodyEl().innerHTML;
  const crawl = bodyEl().querySelector('[data-part="crawl"] .gev-events-crawl');
  assert.ok(crawl, 'crawl');
  // Drawn twice for the loop; the copy is hidden from screen readers.
  assert.equal(crawl.querySelectorAll('[data-act="event"]').length, 8);
  assert.equal(
    crawl.querySelectorAll('[data-act="event"][aria-hidden="true"]').length,
    4,
  );
  assert.match(
    bodyEl().querySelector('.gev-events-now').textContent,
    /Right now/,
  );
  assert.match(html, /Unofficial\. In an emergency call 911\./);
  assert.ok(bodyEl().querySelector('.gev-events-timeline'));
  assert.match(html, /Possibly related · same road: Route 47/);
  assert.match(html, /Not reporting: Coast Guard aircraft feed/);
  assert.match(html, /1 of 2 sources reporting/);
  // The NWS list is unchanged and comes after the live events.
  const nws = bodyEl().querySelector('.gev-local-nws');
  assert.match(nws.textContent, /Official NWS alerts/);
  assert.match(nws.textContent, /Coastal Flood Advisory/);
  assert.ok(nws.querySelector('[data-act="layer"][data-layer="nws-alerts"]'));
  assert.ok(
    html.indexOf('gev-events-live') < html.indexOf('gev-local-nws'),
    'events first',
  );
  // Event text never becomes markup.
  assert.equal(bodyEl().querySelector('img, script'), null);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('clicking an event switches its layer on and flies there; a layer-only event does not fly', async () => {
  await openTab('alerts');
  bodyEl()
    .querySelector(
      '.gev-events-crawl-item[data-id="e-road"]:not([aria-hidden])',
    )
    .click();
  await flush();
  assert.deepEqual(dm.calls, [['traffic-incidents', true, 'user']]);
  assert.equal(viewer.flights.length, 1);
  assert.ok(viewer.flights[0].destination, 'flies to a position');
  assert.equal(panelEl().hidden, false, 'wide screens keep the panel');
  assert.ok(
    bodyEl()
      .querySelector('.gev-events-row[data-id="e-road"]')
      .classList.contains('is-selected'),
  );

  // The Right now line for the NWS advisory: a layer, no position.
  bodyEl().querySelector('.gev-events-now [data-id="e-alert"]').click();
  await flush();
  assert.deepEqual(dm.calls.at(-1), ['nws-alerts', true, 'user']);
  assert.equal(viewer.flights.length, 1);
  // The NWS section's own switch now says it is on.
  const nwsSwitch = bodyEl().querySelector(
    '.gev-local-nws [data-act="layer"][data-layer="nws-alerts"]',
  );
  assert.equal(nwsSwitch.getAttribute('aria-pressed'), 'true');
  assert.equal(nwsSwitch.textContent, 'alert areas: on map');

  // An already-on layer is not switched again.
  bodyEl().querySelector('.gev-events-row[data-id="e-road"]').click();
  await flush();
  assert.equal(dm.calls.length, 2);
  assert.equal(viewer.flights.length, 2);
});

test('a failed events read leaves the NWS list, and a failed NWS read leaves the events', async () => {
  net.routes['/api/local/events'] = () => json({}, 500);
  await openTab('alerts');
  assert.match(bodyEl().textContent, /Live events are unavailable right now\./);
  assert.match(
    bodyEl().querySelector('.gev-local-nws').textContent,
    /Coastal Flood Advisory/,
  );

  net.routes['/api/local/events'] = () => json(eventsBody());
  net.routes['/api/local/nws-alerts'] = () => json({}, 503);
  await openTab('alerts');
  assert.match(
    bodyEl().querySelector('.gev-local-nws').textContent,
    /Could not load NWS alerts/,
  );
  assert.ok(bodyEl().querySelector('.gev-local-nws [data-act="retry"]'));
  assert.ok(bodyEl().querySelector('.gev-events-timeline'));
});

test('events refresh every 30 s with ?since= only while the Alerts tab shows', async () => {
  // Mount again under the mock clock, so every timer the shell starts is
  // one the mock owns (and its disposers can clear).
  destroy();
  mock.timers.enable({ apis: ['setTimeout'] });
  destroy = initLocalShell({ viewer, dataManager: dm });
  await flush();
  const first = eventsBody();
  net.routes['/api/local/events'] = (url) =>
    url.includes('since=')
      ? json({
          ...eventsBody(first.generatedAt + 30_000),
          events: [
            {
              ...first.events[0],
              id: 'e-new',
              key: 'call:fw:2',
              title: 'Water rescue',
              place: 'North Wildwood',
              at: first.generatedAt + 20_000,
              seenAt: first.generatedAt + 25_000,
              threadId: 'e-new',
              related: [],
            },
          ],
        })
      : json(first);
  await openTab('alerts');
  net.log.length = 0;
  mock.timers.tick(29_000);
  await flush();
  assert.equal(net.log.length, 0);
  mock.timers.tick(1_000);
  await flush();
  assert.deepEqual(net.log, [
    `/api/local/events?since=${first.generatedAt - 60_000}`,
  ]);
  // Merged in: the new event joins the ones already shown.
  assert.match(bodyEl().textContent, /Water rescue/);
  assert.match(bodyEl().textContent, /Road closed/);

  // Another tab: the refresh stops.
  panelEl().querySelector('[data-tab="county"]').click();
  await flush();
  net.log.length = 0;
  mock.timers.tick(5 * MIN);
  await flush();
  assert.ok(!net.log.some((url) => url.startsWith('/api/local/events')));

  // Back on Alerts it runs again; closing the panel stops it.
  await openTab('alerts');
  closeLocalPanel();
  net.log.length = 0;
  mock.timers.tick(5 * MIN);
  await flush();
  assert.deepEqual(net.log, []);

  // Destroying the shell stops it too.
  await openTab('alerts');
  destroy();
  destroy = null;
  net.log.length = 0;
  mock.timers.tick(5 * MIN);
  await flush();
  assert.deepEqual(net.log, []);
});

test('the ticker’s LATEST item opens its event in the Alerts tab', async () => {
  let latest = null;
  for (let i = 0; i < 20 && !latest; i += 1) {
    await flush();
    latest = document.querySelector('#gev-county-ticker [data-key="events"]');
  }
  assert.ok(latest, 'LATEST shows the event from the last hour');
  assert.equal(latest.dataset.eventId, 'e-fire');
  assert.equal(panelEl().hidden, true);
  latest.click();
  await flush();
  assert.equal(panelEl().hidden, false);
  assert.equal(
    panelEl().querySelector('[role="tab"][aria-selected="true"]').dataset.tab,
    'alerts',
  );
  assert.deepEqual(dm.calls, [['scanner-calls', true, 'user']]);
  assert.equal(viewer.flights.length, 1);
  assert.ok(
    bodyEl()
      .querySelector('.gev-events-row[data-id="e-fire"]')
      .classList.contains('is-selected'),
  );
});

test('on a phone the sheet gets out of the way after an event click', async () => {
  phoneScreen(true);
  await openTab('alerts');
  bodyEl()
    .querySelector(
      '.gev-events-crawl-item[data-id="e-fire"]:not([aria-hidden])',
    )
    .click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(viewer.flights.length, 1);

  // From the ticker the map moves without the sheet opening.
  const latest = document.querySelector(
    '#gev-county-ticker [data-key="events"]',
  );
  assert.ok(latest);
  latest.click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(viewer.flights.length, 2);
});

// ------------------------------------------------------- switches and tabs

test('every layer that left Data Layers has a switch in the Local panel', async () => {
  const shown = new Set();
  for (const tab of ['calls', 'county', 'news', 'replay']) {
    await openTab(tab);
    layersShown().forEach((id) => shown.add(id));
  }
  for (const id of Object.keys(ELSEWHERE))
    assert.ok(shown.has(id), `${id} (${ELSEWHERE[id]}) has a switch`);
  for (const id of [
    'fuel-prices',
    'space-weather',
    'drought',
    'radiation',
    'outbreaks',
    'internet-outages',
    'disaster-history',
    'county-risk',
    'readiness',
    'daily-brief',
    'credibility-scoring',
    'history-replay',
    'airport-radio',
    'faa-status',
    'vdl2',
  ])
    assert.ok(shown.has(id), id);
  // The same from the tables the tabs draw from.
  const declared = new Set([
    ...Object.values(LOCAL_TAB_TOGGLES).flatMap((rows) =>
      rows.map(([id]) => id),
    ),
    ...DASHBOARD_ITEMS.map((item) => item.id),
  ]);
  for (const id of Object.keys(ELSEWHERE)) assert.ok(declared.has(id), id);
});

test('each tab’s switches sit where the moved layers now live', async () => {
  await openTab('calls');
  assert.deepEqual(
    layersShown().filter((id) => ['airport-radio', 'vdl2'].includes(id)),
    ['airport-radio', 'vdl2'],
  );
  await openTab('news');
  assert.deepEqual(layersShown(), ['daily-brief', 'credibility-scoring']);
  await openTab('replay');
  assert.deepEqual(layersShown(), ['history-replay']);
  assert.match(
    bodyEl().querySelector('[data-layer="history-replay"]').textContent,
    /^Show history replay on map$/,
  );
});

test('a switch keeps its own wording after a click, dashboard cards too', async () => {
  await openTab('calls');
  const vdl2 = bodyEl().querySelector('[data-act="layer"][data-layer="vdl2"]');
  assert.equal(vdl2.textContent, 'Show aircraft datalink (VDL2) on map');
  vdl2.click();
  await flush();
  assert.deepEqual(dm.calls, [['vdl2', true, 'user']]);
  assert.equal(vdl2.textContent, 'aircraft datalink (VDL2): on map');
  assert.equal(vdl2.getAttribute('aria-pressed'), 'true');

  await openTab('county');
  const faa = bodyEl().querySelector(
    '.gev-dash [data-act="layer"][data-layer="faa-status"]',
  );
  assert.equal(faa.textContent, 'Show on map');
  assert.equal(faa.title, 'Airports (FAA) on the map');
  faa.click();
  await flush();
  assert.equal(faa.textContent, 'On map');
  faa.click();
  await flush();
  assert.equal(faa.textContent, 'Show on map');
  assert.deepEqual(dm.calls.slice(1), [
    ['faa-status', true, 'user'],
    ['faa-status', false, 'user'],
  ]);
});

test('County tab: the dashboard first, then planning switches, then conditions', async () => {
  await openTab('county');
  const html = bodyEl().innerHTML;
  const dash = html.indexOf('class="gev-dash"');
  const planning = html.indexOf('data-layer="county-risk"');
  const conditions = html.indexOf('County conditions');
  assert.ok(dash >= 0 && dash < planning && planning < conditions);
  assert.equal(bodyEl().querySelectorAll('.gev-dash-card').length, 8);
  // The dashboard endpoints 404 here: each card says so, none guesses.
  assert.equal(
    bodyEl().querySelectorAll('.gev-dash-value').length,
    [...bodyEl().querySelectorAll('.gev-dash-value')].filter(
      (el) => el.textContent === 'No reading',
    ).length,
  );
  assert.match(bodyEl().textContent, /Unofficial summary from public feeds/);
  assert.ok(bodyEl().querySelector('[data-layer="readiness"]'));
  assert.match(
    bodyEl().textContent,
    /Barrier island causeways & flood bypasses/,
  );
  const cwBtn = bodyEl().querySelector('[data-act="causeway"]');
  assert.ok(cwBtn);
  cwBtn.click();
  assert.equal(viewer.flights.length, 1);
});

test('County tab: failed conditions leave the dashboard and its switches', async () => {
  net.routes['/api/local/conditions'] = () => json({}, 500);
  await openTab('county');
  assert.equal(bodyEl().querySelectorAll('.gev-dash-card').length, 8);
  assert.match(bodyEl().textContent, /Could not load county conditions/);
  assert.ok(bodyEl().querySelector('[data-layer="county-risk"]'));
});

test('News and Replay keep their switches when their feeds fail', async () => {
  net.routes['/api/local/local-news'] = () => json({}, 502);
  net.routes['/api/local/airport-radio'] = () => json({}, 502);
  await openTab('news');
  assert.match(bodyEl().textContent, /Could not load local news/);
  assert.deepEqual(layersShown(), ['daily-brief', 'credibility-scoring']);
  await openTab('replay');
  assert.match(bodyEl().textContent, /UNAVAILABLE/);
  assert.deepEqual(layersShown(), ['history-replay']);
});

// ------------------------------------------- window modes and the HUD

const hudEl = () => document.getElementById('gev-events-hud');
const hudLine = (id) =>
  [...hudEl().querySelectorAll('.gev-hud-lines > li')].find(
    (li) => li.dataset.id === id,
  );
const winButton = (mode) => panelEl().querySelector(`[data-win="${mode}"]`);
const storedWindow = () => JSON.parse(localStorage.getItem(WINDOW_KEY));
const eventsReads = () =>
  net.log.filter((url) => url.startsWith('/api/local/events'));

/** Mount the shell again under the mock clock (its timers are then mocked). */
async function remountWithMockClock(apis = ['setTimeout']) {
  destroy();
  mock.timers.enable({ apis, now: Date.now() });
  destroy = initLocalShell({ viewer, dataManager: dm });
  await flush();
}

async function waitForLatest() {
  let latest = null;
  for (let i = 0; i < 20 && !latest; i += 1) {
    await flush();
    latest = document.querySelector('#gev-county-ticker [data-key="events"]');
  }
  return latest;
}

test('the panel header has Dock left, Dock right, Float and Shrink to HUD', async () => {
  await openTab('alerts');
  const close = panelEl().querySelector('.gev-local-close');
  const controls = [...panelEl().querySelectorAll('.gev-win-btn')];
  assert.deepEqual(
    controls.map((el) => el.getAttribute('aria-label')),
    ['Dock left', 'Dock right', 'Float', 'Shrink to HUD'],
  );
  assert.ok(controls.every((el) => el.title));
  // They sit right before the × close.
  assert.equal(controls.at(-1).parentElement.nextElementSibling, close);
  // The move grip is its own element; "Local conditions" stays a heading.
  const grip = panelEl().querySelector('.gev-local-title .gev-win-grip');
  assert.equal(grip.getAttribute('role'), 'button');
  assert.equal(grip.getAttribute('tabindex'), '0');
  assert.equal(grip.getAttribute('aria-label'), 'Move window, use arrow keys');
  const title = panelEl().querySelector('.gev-local-title');
  assert.equal(title.hasAttribute('role'), false);
  assert.equal(title.querySelector('h2').textContent, 'Local conditions');
  assert.equal(winButton('hud').hasAttribute('aria-pressed'), false);

  winButton('dock-right').click();
  assert.equal(winButton('dock-right').getAttribute('aria-pressed'), 'true');
  assert.ok(panelEl().classList.contains('gev-win-dock-right'));
  assert.equal(storedWindow().mode, 'dock-right');
  // The tabs keep working while docked.
  panelEl().querySelector('[data-tab="county"]').click();
  await flush();
  assert.ok(bodyEl().querySelector('.gev-dash'));
  // Closed and opened again: still docked.
  closeLocalPanel();
  openLocalPanel();
  await flush();
  assert.ok(panelEl().classList.contains('gev-win-dock-right'));
  winButton('float').click();
  assert.ok(panelEl().classList.contains('gev-win-float'));
  assert.equal(storedWindow().mode, 'float');
});

test('Shrink to HUD closes the panel into the HUD; Open Alerts expands it back as it was', async () => {
  await openTab('alerts');
  winButton('dock-left').click();
  winButton('hud').click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false);
  assert.equal(document.activeElement, hudEl().querySelector('.gev-hud-grip'));
  assert.deepEqual(
    [...hudEl().querySelectorAll('.gev-hud-lines > li')].map(
      (li) => li.dataset.id,
    ),
    ['e-fire', 'e-road', 'e-alert', 'e-xss'],
  );
  assert.equal(hudEl().querySelector('.gev-hud-state').textContent, 'LIVE');
  assert.equal(
    hudEl().querySelector('.gev-hud-sources').textContent,
    '1 of 2 sources',
  );
  assert.equal(hudEl().querySelector('img, script'), null);
  assert.deepEqual(
    { mode: storedWindow().mode, hud: storedWindow().hud.open },
    { mode: 'hud', hud: true },
  );

  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  assert.equal(hudEl().hidden, true);
  assert.equal(panelEl().hidden, false);
  assert.equal(
    panelEl().querySelector('[role="tab"][aria-selected="true"]').dataset.tab,
    'alerts',
  );
  assert.ok(panelEl().classList.contains('gev-win-dock-left'));
  assert.deepEqual(
    { mode: storedWindow().mode, hud: storedWindow().hud.open },
    { mode: 'dock-left', hud: false },
  );
});

test('the HUD: Fly to switches the layer on and flies; × closes it; the Local button opens the panel', async () => {
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  hudLine('e-road').querySelector('[data-hud="line"]').click();
  hudLine('e-road').querySelector('[data-hud="fly"]').click();
  await flush();
  assert.deepEqual(dm.calls, [['traffic-incidents', true, 'user']]);
  assert.equal(viewer.flights.length, 1);
  assert.equal(panelEl().hidden, true, 'the panel stays shut');
  assert.equal(hudEl().hidden, false);

  hudEl().querySelector('[data-hud="close"]').click();
  assert.equal(hudEl().hidden, true);
  assert.equal(storedWindow().hud.open, false);
  assert.equal(storedWindow().mode, 'float');
  openLocalPanel();
  await flush();
  assert.equal(panelEl().hidden, false);
  assert.equal(hudEl().hidden, true);
});

test('More in Alerts opens the Alerts tab at that event’s thread, marked', async () => {
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  hudLine('e-road').querySelector('[data-hud="line"]').click();
  hudLine('e-road').querySelector('[data-hud="more"]').click();
  await flush();
  assert.equal(panelEl().hidden, false);
  assert.equal(hudEl().hidden, true);
  const row = bodyEl().querySelector('.gev-events-row[data-id="e-road"]');
  assert.ok(row.classList.contains('is-selected'));
  assert.ok(
    row.closest('.gev-events-thread').classList.contains('is-highlighted'),
  );
  assert.equal(dm.calls.length, 0, 'More in Alerts does not fly');

  // An event with nowhere to fly: its thread is still found and marked.
  winButton('hud').click();
  await flush();
  hudLine('e-xss').querySelector('[data-hud="line"]').click();
  assert.equal(hudLine('e-xss').querySelector('[data-hud="fly"]'), null);
  hudLine('e-xss').querySelector('[data-hud="more"]').click();
  await flush();
  const thread = bodyEl().querySelector('.gev-events-thread[data-id="e-xss"]');
  assert.ok(thread.classList.contains('is-highlighted'));
});

test('a HUD left open is back on the next start, where it was moved to', async () => {
  destroy();
  localStorage.setItem(
    WINDOW_KEY,
    JSON.stringify({
      mode: 'hud',
      float: { x: null, y: null, w: null, h: null },
      dockWidth: 380,
      hud: { open: true, x: 200, y: 300, expandedFrom: 'dock-right' },
    }),
  );
  net.log.length = 0;
  destroy = initLocalShell({ viewer, dataManager: dm });
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false);
  assert.equal(hudEl().style.left, '200px');
  assert.equal(hudEl().style.top, '300px');
  // It read the events at once.
  assert.ok(eventsReads().includes('/api/local/events'));
  assert.ok(hudLine('e-fire'));
  // Open Alerts: the panel in the mode it was in.
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  assert.ok(panelEl().classList.contains('gev-win-dock-right'));

  // A corrupt layout is the default: no HUD, a floating panel.
  destroy();
  localStorage.setItem(WINDOW_KEY, '{"mode":');
  destroy = initLocalShell({ viewer, dataManager: dm });
  await flush();
  assert.equal(hudEl().hidden, true);
  openLocalPanel();
  await flush();
  assert.ok(panelEl().classList.contains('gev-win-float'));
});

test('the ticker’s LATEST opens its event in the HUD when the HUD shows', async () => {
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  const latest = await waitForLatest();
  assert.ok(latest);
  latest.click();
  await flush();
  assert.equal(panelEl().hidden, true, 'the panel stays shut');
  assert.equal(hudEl().hidden, false);
  assert.equal(
    hudLine('e-fire')
      .querySelector('[data-hud="line"]')
      .getAttribute('aria-expanded'),
    'true',
  );
  assert.deepEqual(dm.calls, [['scanner-calls', true, 'user']]);
  assert.equal(viewer.flights.length, 1);
});

test('one poller serves the HUD and the Alerts tab: one read per 30 s', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  // The grip has the focus right after Shrink to HUD; away from the HUD,
  // new events count as unread.
  document.activeElement?.blur?.();
  net.log.length = 0;
  for (let i = 0; i < 10; i += 1) {
    mock.timers.tick(30_000);
    await flush();
  }
  assert.equal(eventsReads().length, 10);
  assert.ok(eventsReads().every((url) => url.includes('since=')));

  // New events reach the HUD as unread lines.
  const first = eventsBody();
  net.routes['/api/local/events'] = () =>
    json({
      ...eventsBody(first.generatedAt + 30_000),
      events: [
        {
          ...first.events[0],
          id: 'e-new',
          key: 'call:fw:9',
          title: 'Water rescue',
          threadId: 'e-new',
          related: [],
          at: Date.now(),
          seenAt: Date.now(),
        },
      ],
    });
  mock.timers.tick(30_000);
  await flush();
  assert.ok(hudLine('e-new'));
  assert.ok(hudLine('e-new').classList.contains('is-new'));
  assert.equal(hudEl().querySelector('.gev-hud-unread').textContent, '1 new');

  // Expanded into the Alerts tab: still one read per 30 s.
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  net.log.length = 0;
  for (let i = 0; i < 4; i += 1) {
    mock.timers.tick(30_000);
    await flush();
  }
  assert.equal(eventsReads().length, 4);
  assert.match(bodyEl().textContent, /Water rescue/);

  // Closed, it shrinks back into the HUD: still one read per 30 s.
  closeLocalPanel();
  assert.equal(hudEl().hidden, false);
  net.log.length = 0;
  for (let i = 0; i < 3; i += 1) {
    mock.timers.tick(30_000);
    await flush();
  }
  assert.equal(eventsReads().length, 3);

  // The HUD closed too: no reads at all.
  hudEl().querySelector('[data-hud="close"]').click();
  net.log.length = 0;
  mock.timers.tick(5 * MIN);
  await flush();
  assert.deepEqual(eventsReads(), []);
});

test('Open Alerts from the HUD, closed before its first read lands: the HUD keeps reading', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  // The Alerts tab's read hangs; the panel is closed back into the HUD.
  net.hold('/api/local/events');
  net.hold('/api/local/nws-alerts');
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  closeLocalPanel();
  await flush();
  assert.equal(hudEl().hidden, false);
  net.release('/api/local/events');
  net.release('/api/local/nws-alerts');
  await flush();
  net.log.length = 0;
  for (let i = 0; i < 3; i += 1) {
    mock.timers.tick(30_000);
    await flush();
  }
  assert.equal(eventsReads().length, 3);
});

test('a HUD whose reads stall shows DELAYED, and the watchdog starts them again', async () => {
  await remountWithMockClock(['setTimeout', 'setInterval', 'Date']);
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  assert.equal(hudEl().dataset.state, 'live');
  // Every read now hangs: nothing lands for minutes.
  net.hold('/api/local/events');
  for (let i = 0; i < 4; i += 1) {
    mock.timers.tick(30_000);
    await flush();
  }
  assert.equal(hudEl().dataset.state, 'delayed');
  net.release('/api/local/events');
  await flush();
  mock.timers.tick(30_000);
  await flush();
  assert.equal(hudEl().dataset.state, 'live');
});

test('the poller pauses while the browser tab is hidden and catches up when shown', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  let state = 'hidden';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    net.log.length = 0;
    mock.timers.tick(5 * MIN);
    await flush();
    assert.deepEqual(eventsReads(), []);
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    assert.equal(eventsReads().length, 1);
    mock.timers.tick(30_000);
    await flush();
    assert.equal(eventsReads().length, 2);
  } finally {
    delete document.visibilityState;
  }
});

test('destroying the shell removes the HUD and stops its reads', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  destroy();
  destroy = null;
  assert.equal(document.getElementById('gev-events-hud'), null);
  net.log.length = 0;
  mock.timers.tick(5 * MIN);
  await flush();
  assert.deepEqual(eventsReads(), []);
});

test('on a phone Shrink to HUD turns the sheet into the strip; LATEST opens there', async () => {
  phoneScreen(true);
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false);
  assert.equal(hudEl().classList.contains('is-placed'), false);
  const latest = await waitForLatest();
  latest.click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudLine('e-fire').classList.contains('is-expanded'), true);
  assert.equal(viewer.flights.length, 1);
  hudLine('e-fire').querySelector('[data-hud="more"]').click();
  await flush();
  assert.equal(panelEl().hidden, false, 'More in Alerts opens the sheet');
  assert.equal(hudEl().hidden, true);
});

// ------------------------------- return to the HUD and keyboard focus

/** The dashboard's Local button (GlobeActions.vue), for focus to land on. */
function localButton() {
  const button = document.createElement('button');
  button.id = 'local-panel-btn';
  button.type = 'button';
  document.body.appendChild(button);
  return button;
}

const escapeKey = () =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );

test('More in Alerts, then ×: the HUD is back, at that line, its button focused', async () => {
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  hudLine('e-road').querySelector('[data-hud="line"]').click();
  hudLine('e-road').querySelector('[data-hud="more"]').click();
  await flush();
  assert.equal(panelEl().hidden, false);
  assert.equal(hudEl().hidden, true);
  panelEl().querySelector('.gev-local-close').focus();
  panelEl().querySelector('.gev-local-close').click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false, 'the HUD came back');
  assert.equal(hudLine('e-road').classList.contains('is-expanded'), true);
  assert.equal(
    document.activeElement,
    hudLine('e-road').querySelector('[data-hud="more"]'),
  );
  assert.deepEqual(
    { mode: storedWindow().mode, hud: storedWindow().hud.open },
    { mode: 'hud', hud: true },
  );
});

test('Open Alerts, then Escape: the HUD is back with Open Alerts focused', async () => {
  await openTab('alerts');
  winButton('dock-right').click();
  winButton('hud').click();
  await flush();
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  assert.ok(panelEl().classList.contains('gev-win-dock-right'));
  assert.equal(
    document.activeElement,
    panelEl().querySelector('.gev-local-close'),
  );
  escapeKey();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false);
  assert.equal(
    document.activeElement,
    hudEl().querySelector('[data-hud="open"]'),
  );
  // It still expands into the dock it came from.
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  assert.ok(panelEl().classList.contains('gev-win-dock-right'));
});

test('the Local button while the HUD shows: a look at the panel, then the HUD again', async () => {
  const button = localButton();
  try {
    await openTab('alerts');
    winButton('hud').click();
    await flush();
    button.focus();
    toggleLocalPanel();
    await flush();
    assert.equal(panelEl().hidden, false);
    assert.equal(hudEl().hidden, true);
    button.focus();
    toggleLocalPanel();
    await flush();
    assert.equal(panelEl().hidden, true);
    assert.equal(hudEl().hidden, false);
    // The focus was on the Local button, outside the panel: it stays there.
    assert.equal(document.activeElement, button);
    // × on the HUD ends it: the panel then opens and closes on its own.
    hudEl().querySelector('.gev-hud-grip').focus();
    hudEl().querySelector('[data-hud="close"]').click();
    assert.equal(hudEl().hidden, true);
    assert.equal(document.activeElement, button);
    openLocalPanel('alerts');
    await flush();
    panelEl().querySelector('.gev-local-close').focus();
    closeLocalPanel();
    assert.equal(hudEl().hidden, true, 'no HUD without asking');
    assert.equal(document.activeElement, button, 'not dropped to <body>');
  } finally {
    button.remove();
  }
});

test('Shrink to HUD while looking at the panel from the HUD: one HUD, grip focused', async () => {
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  hudEl().querySelector('[data-hud="open"]').click();
  await flush();
  winButton('hud').click();
  await flush();
  assert.equal(panelEl().hidden, true);
  assert.equal(hudEl().hidden, false);
  assert.equal(document.activeElement, hudEl().querySelector('.gev-hud-grip'));
  assert.equal(document.querySelectorAll('#gev-events-hud').length, 1);
});

test('switching window modes never drops the keyboard focus', async () => {
  await openTab('alerts');
  winButton('dock-left').click();
  winButton('float').focus();
  winButton('float').click();
  assert.equal(winButton('float').hidden, true);
  assert.equal(document.activeElement, winButton('dock-left'));
  assert.ok(panelEl().contains(document.activeElement));
  winButton('dock-right').focus();
  winButton('dock-right').click();
  assert.equal(document.activeElement, winButton('dock-right'));
  winButton('hud').focus();
  winButton('hud').click();
  await flush();
  assert.equal(document.activeElement, hudEl().querySelector('.gev-hud-grip'));
});

test('a refresh that fails while painting does not stop the poller', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  net.log.length = 0;
  // The next paint throws once (a bad answer, a broken box…).
  const realQuery = panelEl().querySelector;
  let armed = true;
  panelEl().querySelector = function (selector) {
    if (armed && selector === '.gev-local-body') {
      armed = false;
      throw new Error('paint failed');
    }
    return realQuery.call(this, selector);
  };
  try {
    mock.timers.tick(30_000);
    await flush();
    assert.equal(armed, false, 'the paint did fail');
    assert.equal(eventsReads().length, 1);
    // The poller is still on: the next reads come every 30 s.
    mock.timers.tick(30_000);
    await flush();
    mock.timers.tick(30_000);
    await flush();
    assert.equal(eventsReads().length, 3);
  } finally {
    delete panelEl().querySelector;
  }
});

test('showing the HUD reads at once when the events are older than one refresh', async () => {
  await openTab('alerts');
  const realNow = Date.now;
  winButton('hud').click();
  await flush();
  hudEl().querySelector('[data-hud="close"]').click();
  // Fresh: shown again, no read.
  net.log.length = 0;
  openLocalPanel('county');
  await flush();
  winButton('hud').click();
  await flush();
  assert.deepEqual(eventsReads(), []);
  hudEl().querySelector('[data-hud="close"]').click();
  // An hour later: shown again, it reads at once.
  Date.now = () => realNow() + 60 * MIN;
  try {
    openLocalPanel('county');
    await flush();
    net.log.length = 0;
    winButton('hud').click();
    await flush();
    assert.equal(eventsReads().length, 1);
  } finally {
    Date.now = realNow;
  }
});

test('a HUD the page hides (clean view) reads nothing until it shows again', async () => {
  const style = document.createElement('style');
  style.textContent = 'body.ui-clean-view #gev-events-hud { display: none; }';
  document.head.appendChild(style);
  try {
    // The clock moves too: "minutes away" is measured by it.
    await remountWithMockClock(['setTimeout', 'Date']);
    await openTab('alerts');
    winButton('hud').click();
    await flush();
    net.log.length = 0;
    mock.timers.tick(30_000);
    await flush();
    assert.equal(eventsReads().length, 1);
    document.body.classList.add('ui-clean-view');
    await flush();
    mock.timers.tick(100);
    await flush();
    net.log.length = 0;
    mock.timers.tick(5 * MIN);
    await flush();
    assert.deepEqual(eventsReads(), [], 'hidden: no reads');
    document.body.classList.remove('ui-clean-view');
    await flush();
    mock.timers.tick(100);
    await flush();
    // Shown again after minutes away: it catches up at once, then every 30 s.
    assert.equal(eventsReads().length, 1);
    mock.timers.tick(30_000);
    await flush();
    assert.equal(eventsReads().length, 2);
  } finally {
    document.body.classList.remove('ui-clean-view');
    style.remove();
  }
});

test('More in Alerts: the thread glows for a moment; one with no row takes the focus', async () => {
  await remountWithMockClock();
  await openTab('alerts');
  winButton('hud').click();
  await flush();
  hudLine('e-xss').querySelector('[data-hud="line"]').click();
  hudLine('e-xss').querySelector('[data-hud="more"]').click();
  await flush();
  const thread = bodyEl().querySelector('.gev-events-thread[data-id="e-xss"]');
  assert.ok(thread.classList.contains('is-highlighted'));
  // No row to press: the thread itself is focused for a screen reader.
  assert.equal(thread.getAttribute('tabindex'), '-1');
  assert.equal(document.activeElement, thread);
  mock.timers.tick(2_500);
  assert.equal(thread.classList.contains('is-highlighted'), false);
  assert.equal(
    bodyEl().querySelectorAll('.gev-events-thread.is-highlighted').length,
    0,
  );
});
