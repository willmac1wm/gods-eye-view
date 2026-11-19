import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installWatchPanel,
  keyBytes,
  pushSupport,
  watchHtml,
} from './watchPanel.js';

const DATA = {
  places: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Second home',
      name: 'Shore house',
      address: '4600 PARK BLVD, WILDWOOD, NJ, 08260',
      radiusMiles: 0.25,
    },
  ],
  devices: 0,
  radii: [0.1, 0.25, 0.5, 0.75, 1, 2, 5],
  labels: ['Home', 'Second home', 'Family', 'Friend', 'Work', 'Other'],
  maxPlaces: 10,
  pushKey:
    'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`;
    calls.push({ key, body: options.body ? JSON.parse(options.body) : null });
    const answer = routes[key] ?? routes[url];
    const { status = 200, body = {} } =
      typeof answer === 'function' ? answer(options) : answer || {};
    return { ok: status < 300, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test('the panel shows places, distances and the add form; text is escaped', () => {
  const html = watchHtml({
    signedIn: true,
    data: { ...DATA, places: [{ ...DATA.places[0], name: '<b>x</b>' }] },
    push: 'off',
    draft: {},
  });
  assert.match(html, /Your places \(1 of 10\)/);
  assert.match(html, /4600 PARK BLVD, WILDWOOD/);
  assert.match(
    html,
    /<option value="0\.25" selected>within 0\.25 mi<\/option>/,
  );
  assert.match(html, /within 1 mile/);
  assert.match(html, /data-act="push-on"/);
  assert.match(html, /data-act="add"/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('signed out, loading, iPhone-not-installed, blocked and full states', () => {
  assert.match(watchHtml({ loading: true }), /Loading your places/);
  assert.match(
    watchHtml({ signedIn: false }, { signInUrl: '/login?next=%2F' }),
    /href="\/login\?next=%2F">Sign in/,
  );
  assert.match(
    watchHtml({ signedIn: true, data: DATA, push: 'ios-install' }),
    /Add to Home Screen/,
  );
  assert.match(
    watchHtml({ signedIn: true, data: DATA, push: 'denied' }),
    /blocked/,
  );
  assert.match(
    watchHtml({ signedIn: true, data: DATA, push: 'on' }),
    /data-act="test"/,
  );
  const full = { ...DATA, maxPlaces: 1 };
  assert.doesNotMatch(
    watchHtml({ signedIn: true, data: full, push: 'off' }),
    /data-act="add"/,
  );
});

test('push support: iPhone needs the Home Screen app; blocked permission is reported', () => {
  const win = {
    PushManager: {},
    Notification: { permission: 'default' },
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(
    pushSupport({ userAgent: 'iPhone', serviceWorker: {} }, win),
    'ios-install',
  );
  assert.equal(
    pushSupport(
      { userAgent: 'iPhone', standalone: true, serviceWorker: {} },
      win,
    ),
    'ok',
  );
  assert.equal(
    pushSupport(
      { userAgent: 'Chrome', serviceWorker: {} },
      { ...win, Notification: { permission: 'denied' } },
    ),
    'denied',
  );
  assert.equal(pushSupport({ userAgent: 'Chrome' }, win), 'unsupported');
});

test('keyBytes decodes base64url', () => {
  assert.deepEqual([...keyBytes('AQID')], [1, 2, 3]);
  assert.deepEqual([...keyBytes('-_8')], [251, 255]);
});

test('open loads the places; add, change distance and remove talk to the server', async () => {
  document.body.replaceChildren();
  const fetchImpl = fakeFetch({
    'GET /api/watch': { body: DATA },
    'POST /api/watch/places': (o) => ({
      body: {
        ok: true,
        ...DATA,
        places: [
          ...DATA.places,
          {
            id: '22222222-2222-4222-8222-222222222222',
            label: 'Family',
            name: "Mom's",
            address: JSON.parse(o.body).address,
            radiusMiles: 0.5,
          },
        ],
      },
    }),
    [`POST /api/watch/places/${DATA.places[0].id}`]: {
      body: {
        ok: true,
        ...DATA,
        places: [{ ...DATA.places[0], radiusMiles: 1 }],
      },
    },
    [`DELETE /api/watch/places/${DATA.places[0].id}`]: {
      body: { ok: true, ...DATA, places: [] },
    },
  });
  const nav = {
    userAgent: 'Chrome',
    serviceWorker: { getRegistration: async () => null },
  };
  const win = {
    PushManager: {},
    Notification: { permission: 'default' },
    matchMedia: () => ({ matches: false }),
  };
  const watch = installWatchPanel({ fetchImpl, nav, win });
  watch.open();
  await settle();
  await settle();
  const panel = document.getElementById('gev-watch');
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Shore house · Second home/);

  panel.querySelector('#gev-watch-label').value = 'Family';
  panel.querySelector('#gev-watch-name').value = "Mom's";
  panel.querySelector('#gev-watch-address').value =
    '12 Main St, Cape May NJ 08204';
  panel.querySelector('#gev-watch-radius').value = '0.5';
  panel
    .querySelector('[data-act="add"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const add = fetchImpl.calls.find((c) => c.key === 'POST /api/watch/places');
  assert.deepEqual(add.body, {
    label: 'Family',
    name: "Mom's",
    address: '12 Main St, Cape May NJ 08204',
    radiusMiles: 0.5,
  });
  assert.match(panel.textContent, /Added/);
  assert.match(panel.textContent, /Your places \(2 of 10\)/);

  const select = panel.querySelector(`select[data-id="${DATA.places[0].id}"]`);
  select.value = '1';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  await settle();
  assert.deepEqual(
    fetchImpl.calls.find((c) => c.key.startsWith('POST /api/watch/places/'))
      .body,
    { radiusMiles: 1 },
  );

  panel
    .querySelector(`[data-act="remove"][data-id="${DATA.places[0].id}"]`)
    .click();
  await settle();
  await settle();
  assert.ok(
    fetchImpl.calls.some(
      (c) => c.key === `DELETE /api/watch/places/${DATA.places[0].id}`,
    ),
  );
  assert.match(panel.textContent, /No places yet/);
  watch.dispose();
});

test('turning alerts on registers the worker, asks permission and sends the subscription', async () => {
  document.body.replaceChildren();
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'p', auth: 'a' },
    }),
  };
  let registered = null;
  const reg = {
    pushManager: {
      getSubscription: async () => null,
      subscribe: async (options) => {
        assert.equal(options.userVisibleOnly, true);
        assert.ok(options.applicationServerKey instanceof Uint8Array);
        return subscription;
      },
    },
  };
  const nav = {
    userAgent: 'Chrome',
    serviceWorker: {
      getRegistration: async () => null,
      register: async (path) => ((registered = path), reg),
    },
  };
  const win = {
    PushManager: {},
    Notification: {
      permission: 'default',
      requestPermission: async () => 'granted',
    },
    matchMedia: () => ({ matches: false }),
  };
  const fetchImpl = fakeFetch({
    'GET /api/watch': { body: DATA },
    'POST /api/watch/devices': { body: { ok: true, ...DATA, devices: 1 } },
  });
  const watch = installWatchPanel({ fetchImpl, nav, win });
  watch.open();
  await settle();
  await settle();
  document.querySelector('#gev-watch [data-act="push-on"]').click();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(registered, '/push-sw.js');
  const devices = fetchImpl.calls.find(
    (c) => c.key === 'POST /api/watch/devices',
  );
  assert.equal(devices.body.subscription.endpoint, 'https://push.example/abc');
  assert.match(
    document.getElementById('gev-watch').textContent,
    /Alerts are on/,
  );
  watch.dispose();
});

test('the ☰ menu offers Watched places and opens the panel', async () => {
  const { installAccountMenu } = await import('./accountMenu.js');
  document.body.replaceChildren();
  let opened = 0;
  const dispose = installAccountMenu({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        authenticated: true,
        user: {
          id: 1,
          username: 'a',
          displayName: 'A',
          role: 'member',
          tier: 'free',
        },
      }),
    }),
    storage: null,
    openWatch: () => opened++,
  });
  document.getElementById('gev-menu-button').click();
  await settle();
  document.querySelector('#gev-menu [data-act="watch"]').click();
  assert.equal(opened, 1);
  assert.equal(document.getElementById('gev-menu').hidden, true);
  dispose();
});
