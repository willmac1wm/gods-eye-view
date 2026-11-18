/**
 * The ☰ menu, top right: the member's account (name, email, membership,
 * display name), settings (My Town, language, the welcome screen), and
 * about (the field guide, support, privacy, terms). Plain DOM, mounted once
 * for the application lifetime.
 *
 * Email and password are not the site's to change: members sign in with
 * Google or Apple, so the menu says which one and links to it. The display
 * name is the one profile field the site owns (POST /api/auth/profile).
 *
 * English-only county chrome, like the Local panel.
 */
import { signInHref } from '../share/returnView.js';
import { escapeHtml } from './format.js';

/** Keys firstRunExperience.js uses to remember "don't show this again". */
export const WELCOME_STORAGE_KEYS = Object.freeze([
  'gev:first-run-mission:v1',
  'gev:first-run-mission-session:v1',
]);

const ROLE_LABEL = Object.freeze({
  member: 'Member',
  trusted: 'Trusted member',
  master: 'Master',
  admin: 'Admin',
});

const PROVIDERS = Object.freeze({
  google: { name: 'Google', manage: 'https://myaccount.google.com/' },
  apple: { name: 'Apple', manage: 'https://account.apple.com/' },
});

export const MENU_LINKS = Object.freeze([
  // i18n-ignore: the menu is English-only county chrome.
  Object.freeze({ href: '/guide', label: 'Field guide', primary: true }),
  // i18n-ignore: the menu is English-only county chrome.
  Object.freeze({ href: '/support', label: 'Support' }),
  // i18n-ignore: the menu is English-only county chrome.
  Object.freeze({ href: '/privacy', label: 'Privacy' }),
  // i18n-ignore: the menu is English-only county chrome.
  Object.freeze({ href: '/terms', label: 'Terms' }),
  // i18n-ignore: the menu is English-only county chrome.
  Object.freeze({ href: '/donate', label: 'Support the site' }),
]);

const capitalize = (value) =>
  String(value || '').replace(/^\w/, (c) => c.toUpperCase());

/**
 * What the account section says about a public user (/api/auth/me), or null
 * when nobody is signed in.
 */
export function accountSummary(user) {
  if (!user) return null;
  const provider = PROVIDERS[String(user.authProvider || '').toLowerCase()];
  return {
    name: user.displayName || user.username || 'Member',
    email: user.email || '',
    membership: `${ROLE_LABEL[user.role] || capitalize(user.role) || 'Member'} · ${capitalize(user.tier || 'free')}`,
    provider: provider?.name || null,
    manageUrl: provider?.manage || null,
    isAdmin: user.isAdmin === true,
  };
}

const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => [...part][0] || '')
    .join('')
    .toUpperCase() || '?';

function accountHtml(state, signInUrl) {
  if (state.loading)
    return '<p class="gev-menu-note">Checking your sign-in…</p>';
  const account = accountSummary(state.user);
  if (!account)
    return `<p class="gev-menu-note">Sign in with Google or Apple to set your name and turn on alerts.</p>
      <div class="gev-menu-links"><a class="gev-local-btn is-active" href="${escapeHtml(signInUrl)}">Sign in</a></div>`;
  return `<div class="gev-menu-user">
      <span class="gev-menu-avatar" aria-hidden="true">${escapeHtml(initials(account.name))}</span>
      <div><strong>${escapeHtml(account.name)}</strong>${account.email ? `<span>${escapeHtml(account.email)}</span>` : ''}</div>
    </div>
    <dl class="gev-local-fields">
      <dt>Membership</dt><dd>${escapeHtml(account.membership)}</dd>
      ${account.provider ? `<dt>Signed in with</dt><dd>${escapeHtml(account.provider)}</dd>` : ''}
    </dl>
    <form class="gev-menu-rename" data-act="rename" novalidate>
      <label class="gev-local-label" for="gev-menu-name">Display name</label>
      <div class="gev-menu-row">
        <input id="gev-menu-name" name="displayName" type="text" maxlength="40" autocomplete="nickname" value="${escapeHtml(state.draft ?? account.name)}">
        <button type="submit" class="gev-local-btn">Save</button>
      </div>
      <p class="gev-menu-msg" role="status">${escapeHtml(state.message || '')}</p>
    </form>
    <p class="gev-menu-note">${
      account.provider
        ? `Your email and password belong to your ${escapeHtml(account.provider)} account. <a href="${escapeHtml(account.manageUrl)}" target="_blank" rel="noopener noreferrer">Change them at ${escapeHtml(account.provider)} ↗</a>`
        : 'Your email and password belong to the account you signed in with.'
    }</p>
    <div class="gev-menu-links">
      <a class="gev-local-btn is-quiet" href="/account">Account page</a>
      ${account.isAdmin ? '<a class="gev-local-btn is-quiet" href="/manager">Manager</a>' : ''}
      <a class="gev-local-btn is-quiet" href="/logout">Sign out</a>
    </div>`;
}

/**
 * The menu's markup. Pure, so it can be tested without a page.
 * @param {{loading?: boolean, user?: object|null, draft?: string, message?: string, settingsMessage?: string}} state
 * @param {{signInUrl?: string}} [options]
 */
export function menuHtml(state = {}, { signInUrl = '/login' } = {}) {
  return `
    <header class="gev-local-head">
      <div><span class="gev-local-kicker">Cape May Dispatch</span><h2 id="gev-menu-title">Menu</h2></div>
      <button type="button" class="gev-local-close" data-act="close" aria-label="Close menu">×</button>
    </header>
    <div class="gev-menu-body ui-scroll">
      <section class="gev-menu-section" aria-labelledby="gev-menu-h-account">
        <h3 id="gev-menu-h-account" class="gev-local-label">Account</h3>
        ${accountHtml(state, signInUrl)}
      </section>
      <section class="gev-menu-section" aria-labelledby="gev-menu-h-settings">
        <h3 id="gev-menu-h-settings" class="gev-local-label">Settings</h3>
        <div class="gev-menu-settings">
          <button type="button" class="gev-menu-item" data-act="town"><span>My Town</span><small>Pick your town so lists show what's near you</small></button>
          <button type="button" class="gev-menu-item" data-act="language"><span>Language</span><small>Change the interface language</small></button>
          <button type="button" class="gev-menu-item" data-act="welcome"><span>Welcome screen</span><small>Show the first-launch choices again next time</small></button>
        </div>
        <p class="gev-menu-msg" role="status">${escapeHtml(state.settingsMessage || '')}</p>
      </section>
      <section class="gev-menu-section" aria-labelledby="gev-menu-h-about">
        <h3 id="gev-menu-h-about" class="gev-local-label">About</h3>
        <p class="gev-menu-note">Cape May Dispatch is an independent, free situational-awareness map for Cape May County, New Jersey. It is not a 9-1-1 service: in an emergency, call 9-1-1.</p>
        <div class="gev-menu-links">
          ${MENU_LINKS.map((link) => `<a class="gev-local-btn${link.primary ? ' is-active' : ' is-quiet'}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join('')}
        </div>
      </section>
    </div>`;
}

/**
 * Mount the ☰ button and its menu. Returns the disposer.
 * @param {{doc?: Document, fetchImpl?: Function, openLocal?: (tab: string) => void, storage?: Storage|null, location?: Location}} options
 */
export function installAccountMenu({
  doc = globalThis.document,
  fetchImpl = (...args) => globalThis.fetch(...args),
  openLocal,
  storage,
  location = globalThis.location,
} = {}) {
  if (!doc?.body) return () => {};
  const store = () => {
    try {
      return storage === undefined ? globalThis.localStorage : storage;
    } catch {
      return null;
    }
  };
  const session = () => {
    try {
      return globalThis.sessionStorage;
    } catch {
      return null;
    }
  };

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = 'gev-menu-button';
  // i18n-ignore: the menu is English-only county chrome.
  button.setAttribute('aria-label', 'Menu');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'gev-menu');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  const panel = doc.createElement('section');
  panel.id = 'gev-menu';
  panel.className = 'gev-local-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'gev-menu-title');
  panel.hidden = true;

  doc.body.append(button, panel);

  // On wide screens the button joins the top row of round map buttons, so it
  // reads as part of the app and stays clear of the corner HUD. On phones
  // that row is already full beside the logo, so the button floats at the
  // end of the county ticker instead (local.css). The row is drawn by the
  // app chrome, which can mount after this shell; until it exists the
  // button floats.
  const view = doc.defaultView || globalThis;
  let phone = null;
  try {
    phone = view.matchMedia?.('(max-width: 720px)') || null;
  } catch {
    phone = null;
  }
  let placeTries = 0;
  let placeTimer = null;
  const placeButton = () => {
    clearTimeout(placeTimer);
    const row = doc.getElementById('top-center-actions');
    if (row && !phone?.matches) {
      if (button.parentElement !== row) row.appendChild(button);
      return;
    }
    if (button.parentElement !== doc.body) doc.body.insertBefore(button, panel);
    if (!row && ++placeTries < 40) placeTimer = setTimeout(placeButton, 500);
  };
  placeButton();
  phone?.addEventListener?.('change', placeButton);

  /** Open the menu just under the button, kept on screen. */
  const anchorPanel = () => {
    const rect = button.getBoundingClientRect?.();
    const width = Math.min(360, (view.innerWidth || 400) - 24);
    if (!rect || !Number.isFinite(rect.bottom) || rect.bottom <= 0) return;
    const left = Math.max(
      12,
      Math.min(rect.right - width, (view.innerWidth || width) - width - 12),
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.right = 'auto';
    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
    panel.style.maxHeight = `calc(100dvh - ${Math.round(rect.bottom + 20)}px)`;
  };

  let state = { loading: true, user: null, message: '', settingsMessage: '' };
  let request = 0;
  const signInUrl = () => {
    try {
      return signInHref(location);
    } catch {
      return '/login';
    }
  };
  /** Where focus sits inside the panel, as a selector that survives a re-render. */
  const focusSelector = (el) => {
    if (!el || el === panel || !panel.contains(el)) return null;
    if (el.id) return `#${el.id}`;
    if (el.matches?.('button[type="submit"]'))
      return '[data-act="rename"] button[type="submit"]';
    const act = el.closest?.('[data-act]')?.dataset?.act;
    return act ? `[data-act="${act}"]` : '[data-act="close"]';
  };
  // Every render replaces the panel's markup, so focus is carried across:
  // otherwise the /api/auth/me reply, a Save or a setting would drop a
  // keyboard or screen-reader user back to <body>.
  const render = () => {
    const active = doc.activeElement;
    const selector = focusSelector(active);
    const caret =
      active?.id === 'gev-menu-name'
        ? [active.selectionStart, active.selectionEnd]
        : null;
    panel.innerHTML = menuHtml(state, { signInUrl: signInUrl() });
    if (!selector) return;
    const next =
      panel.querySelector(selector) ||
      panel.querySelector('[data-act="close"]');
    next?.focus();
    if (caret && typeof next?.setSelectionRange === 'function') {
      try {
        next.setSelectionRange(caret[0], caret[1]);
      } catch {
        /* not a text field any more */
      }
    }
  };

  const loadUser = async () => {
    const mine = ++request;
    try {
      const response = await fetchImpl('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const body = response.ok ? await response.json() : null;
      if (mine !== request) return;
      state = {
        ...state,
        loading: false,
        user: body?.authenticated ? body.user : null,
      };
    } catch {
      if (mine !== request) return;
      state = { ...state, loading: false, user: null };
    }
    if (!panel.hidden) render();
  };

  const open = () => {
    state = {
      ...state,
      loading: true,
      draft: undefined,
      message: '',
      settingsMessage: '',
    };
    render();
    anchorPanel();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    panel.querySelector('[data-act="close"]')?.focus();
    void loadUser();
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  };

  button.addEventListener('click', () => (panel.hidden ? open() : close()));

  panel.addEventListener('click', (event) => {
    const act = event.target?.closest?.('[data-act]')?.dataset?.act;
    if (act === 'close') close();
    else if (act === 'town') {
      close({ restoreFocus: false });
      openLocal?.('town');
    } else if (act === 'language') {
      close({ restoreFocus: false });
      doc.querySelector('.locale-picker-button')?.click();
    } else if (act === 'welcome') {
      for (const key of WELCOME_STORAGE_KEYS) {
        try {
          store()?.removeItem(key);
        } catch {
          /* storage blocked */
        }
        try {
          session()?.removeItem(key);
        } catch {
          /* storage blocked */
        }
      }
      state = {
        ...state,
        settingsMessage:
          'The welcome screen will show the next time you open the map.',
      };
      render();
    }
  });

  // What the member has typed but not saved survives any re-render.
  panel.addEventListener('input', (event) => {
    if (event.target?.id === 'gev-menu-name')
      state = { ...state, draft: event.target.value };
  });

  panel.addEventListener('submit', async (event) => {
    if (!event.target?.matches?.('[data-act="rename"]')) return;
    event.preventDefault();
    const input = panel.querySelector('#gev-menu-name');
    const typed = String(input?.value ?? state.draft ?? '');
    state = { ...state, draft: typed };
    const displayName = typed.trim();
    if (!displayName) {
      state = { ...state, message: 'Type a name first.' };
      render();
      return;
    }
    try {
      const response = await fetchImpl('/api/auth/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json().catch(() => ({}));
      state = response.ok
        ? {
            ...state,
            user: body.user || state.user,
            draft: undefined,
            message: 'Saved.',
          }
        : { ...state, message: body.error || 'Could not save. Try again.' };
      if (response.ok && body.user) {
        // The Local panel's account button shows the name too.
        try {
          doc.dispatchEvent(
            new view.CustomEvent('gev:account-updated', {
              detail: { user: body.user },
            }),
          );
        } catch {
          /* no CustomEvent in this environment */
        }
      }
    } catch {
      state = { ...state, message: 'Could not save. Check your connection.' };
    }
    render();
  });

  // On window, capture phase: it runs before the details window's own
  // Escape handler on document, so one Escape closes only the menu on top.
  const onKey = (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopImmediatePropagation();
      close();
    }
  };
  const onPointer = (event) => {
    if (panel.hidden) return;
    if (panel.contains(event.target) || button.contains(event.target)) return;
    close({ restoreFocus: false });
  };
  view.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);

  return () => {
    request++;
    clearTimeout(placeTimer);
    phone?.removeEventListener?.('change', placeButton);
    view.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    button.remove();
    panel.remove();
  };
}
