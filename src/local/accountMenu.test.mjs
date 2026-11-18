import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MENU_LINKS,
  WELCOME_STORAGE_KEYS,
  accountSummary,
  installAccountMenu,
  menuHtml,
} from './accountMenu.js';

const MEMBER = {
  id: 'u1',
  username: 'resident',
  email: 'resident@capemay.test',
  displayName: 'Cape Resident',
  tier: 'free',
  role: 'member',
  isAdmin: false,
  authProvider: 'google',
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    has: (k) => data.has(k),
  };
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const answer = routes[url];
    const { status = 200, body = {} } =
      typeof answer === 'function' ? answer(options) : answer || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
  impl.calls = calls;
  return impl;
}

test('the account summary names the member, membership and sign-in provider', () => {
  assert.deepEqual(accountSummary(MEMBER), {
    name: 'Cape Resident',
    email: 'resident@capemay.test',
    membership: 'Member · Free',
    provider: 'Google',
    manageUrl: 'https://myaccount.google.com/',
    isAdmin: false,
  });
  assert.equal(
    accountSummary({ ...MEMBER, role: 'trusted', tier: 'supporter' })
      .membership,
    'Trusted member · Supporter',
  );
  assert.equal(
    accountSummary({ ...MEMBER, authProvider: 'apple' }).provider,
    'Apple',
  );
  assert.equal(
    accountSummary({ ...MEMBER, authProvider: 'legacy' }).provider,
    null,
  );
  assert.equal(accountSummary(null), null);
});

test('signed in, the menu shows the account, the name form, settings and the guide', () => {
  const html = menuHtml({ loading: false, user: MEMBER });
  for (const text of [
    'Cape Resident',
    'resident@capemay.test',
    'Member · Free',
    'Signed in with</dt><dd>Google',
    'id="gev-menu-name"',
    'href="https://myaccount.google.com/"',
    'href="/account"',
    'href="/logout"',
    'data-act="town"',
    'data-act="language"',
    'data-act="welcome"',
    'href="/guide"',
    'not a 9-1-1 service',
  ])
    assert.ok(html.includes(text), `missing ${text}`);
  assert.doesNotMatch(html, /href="\/manager"/, 'only admins see Manager');
  assert.match(
    menuHtml({
      loading: false,
      user: { ...MEMBER, isAdmin: true, role: 'admin' },
    }),
    /href="\/manager"/,
  );
});

test('signed out, the menu offers sign-in and still has settings and the guide', () => {
  const html = menuHtml(
    { loading: false, user: null },
    { signInUrl: '/login?next=%2F' },
  );
  assert.match(html, /href="\/login\?next=%2F">Sign in</);
  assert.doesNotMatch(html, /gev-menu-name|href="\/logout"/);
  assert.match(html, /data-act="town"/);
  assert.match(html, /href="\/guide"/);
  assert.match(menuHtml({ loading: true }), /Checking your sign-in/);
});

test('member text is escaped', () => {
  const html = menuHtml({
    loading: false,
    user: { ...MEMBER, displayName: '<img src=x onerror=alert(1)>' },
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('the about links are same-site pages, the guide first', () => {
  assert.equal(MENU_LINKS[0].href, '/guide');
  assert.ok(MENU_LINKS.every((link) => link.href.startsWith('/')));
});

test('the welcome keys match the ones the first-launch screen stores', () => {
  const source = readFileSync(
    new URL('../firstRunExperience.js', import.meta.url),
    'utf8',
  );
  for (const key of WELCOME_STORAGE_KEYS)
    assert.ok(
      source.includes(`'${key}'`),
      `${key} not in firstRunExperience.js`,
    );
});

test('the ☰ button opens the menu, loads the member and closes on Escape', async () => {
  document.body.replaceChildren();
  const fetchImpl = fakeFetch({
    '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
  });
  const dispose = installAccountMenu({ fetchImpl, storage: memoryStorage() });
  const button = document.getElementById('gev-menu-button');
  const panel = document.getElementById('gev-menu');
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  await settle();
  assert.match(panel.textContent, /Cape Resident/);
  assert.equal(fetchImpl.calls[0].options.credentials, 'same-origin');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(panel.hidden, true);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  dispose();
  assert.equal(document.getElementById('gev-menu-button'), null);
});

test('saving a display name posts JSON and shows the new name', async () => {
  document.body.replaceChildren();
  const fetchImpl = fakeFetch({
    '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
    '/api/auth/profile': (options) => ({
      body: {
        ok: true,
        user: { ...MEMBER, displayName: JSON.parse(options.body).displayName },
      },
    }),
  });
  const dispose = installAccountMenu({ fetchImpl, storage: memoryStorage() });
  document.getElementById('gev-menu-button').click();
  await settle();
  const panel = document.getElementById('gev-menu');
  panel.querySelector('#gev-menu-name').value = 'Lifeguard Dan';
  panel
    .querySelector('[data-act="rename"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  const post = fetchImpl.calls.find((c) => c.url === '/api/auth/profile');
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(post.options.body), {
    displayName: 'Lifeguard Dan',
  });
  assert.match(panel.textContent, /Lifeguard Dan/);
  assert.match(panel.textContent, /Saved\./);
  dispose();
});

test('a refused name shows the server reason', async () => {
  document.body.replaceChildren();
  const fetchImpl = fakeFetch({
    '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
    '/api/auth/profile': {
      status: 400,
      body: { error: 'Use 1 to 40 characters for your name' },
    },
  });
  const dispose = installAccountMenu({ fetchImpl, storage: memoryStorage() });
  document.getElementById('gev-menu-button').click();
  await settle();
  const panel = document.getElementById('gev-menu');
  panel
    .querySelector('[data-act="rename"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.match(panel.textContent, /Use 1 to 40 characters/);
  dispose();
});

test('settings: My Town opens the Local panel, Welcome screen clears the stored choice', async () => {
  document.body.replaceChildren();
  const opened = [];
  const storage = memoryStorage({ [WELCOME_STORAGE_KEYS[0]]: 'suppressed' });
  const dispose = installAccountMenu({
    fetchImpl: fakeFetch({
      '/api/auth/me': { body: { authenticated: false } },
    }),
    storage,
    openLocal: (tab) => opened.push(tab),
  });
  const button = document.getElementById('gev-menu-button');
  const panel = document.getElementById('gev-menu');
  button.click();
  await settle();
  panel.querySelector('[data-act="welcome"]').click();
  assert.equal(storage.has(WELCOME_STORAGE_KEYS[0]), false);
  assert.match(panel.textContent, /welcome screen will show/);
  panel.querySelector('[data-act="town"]').click();
  assert.deepEqual(opened, ['town']);
  assert.equal(panel.hidden, true);
  dispose();
});

test('focus stays inside the menu when the member loads and after a setting re-renders it', async () => {
  document.body.replaceChildren();
  const dispose = installAccountMenu({
    fetchImpl: fakeFetch({
      '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
    }),
    storage: memoryStorage(),
  });
  document.getElementById('gev-menu-button').click();
  const panel = document.getElementById('gev-menu');
  assert.equal(document.activeElement?.dataset?.act, 'close');
  await settle();
  // The /api/auth/me reply re-rendered the panel; focus came back to ×.
  assert.equal(document.activeElement?.dataset?.act, 'close');
  assert.ok(panel.contains(document.activeElement));
  panel.querySelector('[data-act="welcome"]').focus();
  panel.querySelector('[data-act="welcome"]').click();
  assert.equal(document.activeElement?.dataset?.act, 'welcome');
  dispose();
});

test('a typed name survives a refused save and other re-renders', async () => {
  document.body.replaceChildren();
  const dispose = installAccountMenu({
    fetchImpl: fakeFetch({
      '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
      '/api/auth/profile': {
        status: 429,
        body: { error: 'Too many changes. Please wait a minute.' },
      },
    }),
    storage: memoryStorage(),
  });
  document.getElementById('gev-menu-button').click();
  await settle();
  const panel = document.getElementById('gev-menu');
  const input = panel.querySelector('#gev-menu-name');
  input.value = 'Lifeguard Dan';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  panel.querySelector('[data-act="welcome"]').click(); // re-render with focus elsewhere
  assert.equal(panel.querySelector('#gev-menu-name').value, 'Lifeguard Dan');
  panel
    .querySelector('[data-act="rename"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.match(panel.textContent, /Too many changes/);
  assert.equal(panel.querySelector('#gev-menu-name').value, 'Lifeguard Dan');
  dispose();
});

test('a saved name is announced so the Local panel can show it', async () => {
  document.body.replaceChildren();
  const heard = [];
  const listener = (event) => heard.push(event.detail.user.displayName);
  document.addEventListener('gev:account-updated', listener);
  const dispose = installAccountMenu({
    fetchImpl: fakeFetch({
      '/api/auth/me': { body: { authenticated: true, user: MEMBER } },
      '/api/auth/profile': {
        body: { ok: true, user: { ...MEMBER, displayName: 'Dan' } },
      },
    }),
    storage: memoryStorage(),
  });
  document.getElementById('gev-menu-button').click();
  await settle();
  const panel = document.getElementById('gev-menu');
  panel.querySelector('#gev-menu-name').value = 'Dan';
  panel
    .querySelector('[data-act="rename"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.deepEqual(heard, ['Dan']);
  document.removeEventListener('gev:account-updated', listener);
  dispose();
});

test('one Escape closes only the menu, not a details window under it', async () => {
  document.body.replaceChildren();
  let detailsClosed = 0;
  const detailsEscape = (event) => {
    if (event.key === 'Escape') detailsClosed++;
  };
  document.addEventListener('keydown', detailsEscape, true);
  const dispose = installAccountMenu({
    fetchImpl: fakeFetch({
      '/api/auth/me': { body: { authenticated: false } },
    }),
    storage: memoryStorage(),
  });
  document.getElementById('gev-menu-button').click();
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(document.getElementById('gev-menu').hidden, true);
  assert.equal(detailsClosed, 0);
  // With the menu closed, Escape reaches the details window again.
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  assert.equal(detailsClosed, 1);
  document.removeEventListener('keydown', detailsEscape, true);
  dispose();
});
