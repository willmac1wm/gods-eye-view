/**
 * Watched places: the member adds addresses (home, a second home, family,
 * friends…) with a distance, and turns on alerts on this device. The server
 * (server/providers/local/watchList.js) keeps the places and sends a push
 * when an incident is reported within that distance.
 *
 * Plain DOM, opened from the ☰ menu. English-only county chrome, like the
 * Local panel.
 */
import { signInHref } from '../share/returnView.js';
import { PUSH_WORKER_PATH } from '../legacyServiceWorker.js';
import { escapeHtml } from './format.js';

/** The label sent when none is picked; one of the server's WATCH_LABELS. */
const FALLBACK_LABEL = 'Home';

const LABEL_EXAMPLES = Object.freeze({
  Home: 'e.g. our house',
  'Second home': 'e.g. the shore house',
  Family: "e.g. Mom's house",
  Friend: "e.g. Jim's place",
  Work: 'e.g. the office',
  Other: 'e.g. the marina',
});

const milesText = (r) => (r === 1 ? '1 mile' : `${r} mi`);

/** base64url → Uint8Array, for pushManager.subscribe's applicationServerKey. */
export function keyBytes(base64url) {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = globalThis.atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Whether this browser can take push alerts, and why not. */
export function pushSupport(nav = globalThis.navigator, win = globalThis) {
  const ua = String(nav?.userAgent || '');
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone =
    nav?.standalone === true ||
    win?.matchMedia?.('(display-mode: standalone)')?.matches === true;
  if (ios && !standalone) return 'ios-install';
  if (!nav?.serviceWorker || !win?.PushManager || !win?.Notification)
    return 'unsupported';
  if (win.Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function pushHtml(state) {
  const p = state.push;
  const line = (text) => `<p class="gev-menu-note">${text}</p>`;
  if (p === 'ios-install')
    return line(
      'On iPhone or iPad, add Cape May Dispatch to your Home Screen first: tap <b>Share</b>, then <b>Add to Home Screen</b>, and open it from there. Then turn alerts on.',
    );
  if (p === 'unsupported') return line('This browser cannot show alerts.');
  if (p === 'denied')
    return line(
      'Alerts are blocked for this site in your browser settings. Allow notifications for capemaydispatch.com, then come back here.',
    );
  if (p === 'on')
    return `${line('Alerts are <b>on</b> for this device.')}
      <div class="gev-menu-links">
        <button type="button" class="gev-local-btn" data-act="test">Send a test alert</button>
        <button type="button" class="gev-local-btn is-quiet" data-act="push-off">Turn off on this device</button>
      </div>`;
  return `${line('Alerts are off on this device.')}
    <div class="gev-menu-links"><button type="button" class="gev-local-btn is-active" data-act="push-on">Turn on alerts on this device</button></div>`;
}

function placeHtml(place, radii) {
  const title = place.name ? `${place.name} · ${place.label}` : place.label;
  return `<li class="gev-watch-place" data-id="${escapeHtml(place.id)}">
    <div class="gev-watch-place-text"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(place.address)}</span></div>
    <div class="gev-menu-row">
      <label class="gev-local-sr" for="gev-watch-r-${escapeHtml(place.id)}">Alert distance for ${escapeHtml(title)}</label>
      <select id="gev-watch-r-${escapeHtml(place.id)}" data-act="radius" data-id="${escapeHtml(place.id)}">
        ${radii.map((r) => `<option value="${r}"${r === place.radiusMiles ? ' selected' : ''}>within ${milesText(r)}</option>`).join('')}
      </select>
      <button type="button" class="gev-local-btn is-quiet" data-act="remove" data-id="${escapeHtml(place.id)}">Remove</button>
    </div>
  </li>`;
}

/**
 * The panel's markup. Pure, so it can be tested without a page.
 * @param {object} state
 * @param {{signInUrl?: string}} [options]
 */
export function watchHtml(state, { signInUrl = '/login' } = {}) {
  const head = `<header class="gev-local-head">
      <div><span class="gev-local-kicker">Your account</span><h2 id="gev-watch-title">Watched places</h2></div>
      <button type="button" class="gev-local-close" data-act="close" aria-label="Close watched places">×</button>
    </header>`;
  if (state.loading)
    return `${head}<div class="gev-menu-body"><p class="gev-menu-note">Loading your places…</p></div>`;
  if (!state.signedIn)
    return `${head}<div class="gev-menu-body">
      <p class="gev-menu-note">Sign in with Google or Apple to watch addresses and get an alert when something happens near them.</p>
      <div class="gev-menu-links"><a class="gev-local-btn is-active" href="${escapeHtml(signInUrl)}">Sign in</a></div>
    </div>`;
  const data = state.data || {};
  const radii = data.radii || [0.5];
  const labels = data.labels || ['Home'];
  const places = data.places || [];
  const draft = state.draft || {};
  const full = places.length >= (data.maxPlaces || 10);
  return `${head}<div class="gev-menu-body ui-scroll">
    <section class="gev-menu-section" aria-labelledby="gev-watch-h-alerts">
      <h3 id="gev-watch-h-alerts" class="gev-local-label">Alerts on this device</h3>
      ${pushHtml(state)}
    </section>
    <section class="gev-menu-section" aria-labelledby="gev-watch-h-places">
      <h3 id="gev-watch-h-places" class="gev-local-label">Your places (${places.length} of ${data.maxPlaces || 10})</h3>
      ${places.length ? `<ul class="gev-watch-list">${places.map((p) => placeHtml(p, radii)).join('')}</ul>` : '<p class="gev-menu-note">No places yet. Add your home, a second home, or family and friends.</p>'}
    </section>
    ${
      full
        ? ''
        : `<section class="gev-menu-section" aria-labelledby="gev-watch-h-add">
      <h3 id="gev-watch-h-add" class="gev-local-label">Add a place</h3>
      <form class="gev-watch-form" data-act="add" novalidate>
        <div class="gev-menu-row">
          <label class="gev-local-sr" for="gev-watch-label">Kind of place</label>
          <select id="gev-watch-label" name="label">
            ${labels.map((l) => `<option${l === (draft.label || labels[0]) ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}
          </select>
          <label class="gev-local-sr" for="gev-watch-name">Name (optional)</label>
          <input id="gev-watch-name" name="name" type="text" maxlength="40" placeholder="${escapeHtml(LABEL_EXAMPLES[draft.label || labels[0]] || 'Name (optional)')}" value="${escapeHtml(draft.name || '')}">
        </div>
        <label class="gev-local-sr" for="gev-watch-address">Street address</label>
        <input id="gev-watch-address" name="address" type="text" maxlength="200" autocomplete="street-address" placeholder="Street address, town, ZIP" value="${escapeHtml(draft.address || '')}">
        <div class="gev-menu-row">
          <label class="gev-local-sr" for="gev-watch-radius">Alert distance</label>
          <select id="gev-watch-radius" name="radius">
            ${radii.map((r) => `<option value="${r}"${r === (draft.radius ?? 0.5) ? ' selected' : ''}>within ${milesText(r)}</option>`).join('')}
          </select>
          <button type="submit" class="gev-local-btn is-active">Add place</button>
        </div>
        <button type="button" class="gev-local-btn is-quiet" data-act="here">Use where I am now instead of an address</button>
      </form>
    </section>`
    }
    <p class="gev-menu-msg" role="status">${escapeHtml(state.message || '')}</p>
    <p class="gev-menu-note">Alerts cover police, fire and EMS calls (while the scanner feed runs), traffic incidents, approved community reports, tide gauges at flood stage, and National Weather Service warnings. Your addresses stay private on our server and are never shown to anyone; remove them any time.</p>
  </div>`;
}

/**
 * Mount the panel once. Returns { open, dispose }.
 * @param {{doc?: Document, fetchImpl?: Function, nav?: Navigator, win?: object, location?: Location}} options
 */
export function installWatchPanel({
  doc = globalThis.document,
  fetchImpl = (...args) => globalThis.fetch(...args),
  nav = globalThis.navigator,
  win = globalThis,
  location = globalThis.location,
} = {}) {
  if (!doc?.body) return { open() {}, dispose() {} };
  const panel = doc.createElement('section');
  panel.id = 'gev-watch';
  panel.className = 'gev-local-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'gev-watch-title');
  panel.hidden = true;
  doc.body.appendChild(panel);

  let state = {
    loading: true,
    signedIn: false,
    data: null,
    push: 'off',
    draft: {},
    message: '',
  };
  let lastFocus = null;

  const api = async (method, path, body) => {
    const response = await fetchImpl(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  };

  const render = () => {
    const active = doc.activeElement;
    const keep =
      active && panel.contains(active) && active.id ? `#${active.id}` : null;
    panel.innerHTML = watchHtml(state, { signInUrl: signInHref(location) });
    const next = keep ? panel.querySelector(keep) : null;
    (
      next ||
      (panel.contains(active)
        ? panel.querySelector('[data-act="close"]')
        : null)
    )?.focus?.();
  };

  const registration = async () => {
    try {
      return (
        (await nav.serviceWorker.getRegistration(PUSH_WORKER_PATH)) || null
      );
    } catch {
      return null;
    }
  };

  /** Is this device subscribed? If so, make sure the server knows it. */
  const refreshPush = async () => {
    const support = pushSupport(nav, win);
    if (support !== 'ok') {
      state = { ...state, push: support };
      return;
    }
    const reg = await registration();
    const sub = await reg?.pushManager?.getSubscription?.();
    if (sub && win.Notification.permission === 'granted') {
      state = { ...state, push: 'on' };
      await api('POST', '/api/watch/devices', { subscription: sub.toJSON() });
    } else state = { ...state, push: 'off' };
  };

  const load = async () => {
    state = { ...state, loading: true, message: '' };
    render();
    try {
      const { ok, status, payload } = await api('GET', '/api/watch');
      state =
        status === 401
          ? { ...state, loading: false, signedIn: false }
          : ok
            ? { ...state, loading: false, signedIn: true, data: payload }
            : {
                ...state,
                loading: false,
                signedIn: true,
                message: payload.error || 'Could not load your places.',
              };
      if (state.signedIn) await refreshPush();
    } catch {
      state = {
        ...state,
        loading: false,
        message: 'Could not load your places. Check your connection.',
      };
    }
    render();
  };

  const open = () => {
    lastFocus = doc.activeElement;
    panel.hidden = false;
    void load();
    panel.querySelector('[data-act="close"]')?.focus();
  };
  const close = () => {
    panel.hidden = true;
    if (lastFocus && doc.contains(lastFocus)) lastFocus.focus?.();
  };

  const tell = (message) => {
    state = { ...state, message };
    render();
  };
  const apply = (result, okMessage) => {
    if (result.ok) {
      state = {
        ...state,
        data: { ...state.data, ...result.payload },
        message: okMessage,
      };
    } else
      state = {
        ...state,
        message: result.payload.error || 'That did not work. Try again.',
      };
    render();
  };

  const addPlace = async (body) => {
    tell('Adding…');
    const result = await api('POST', '/api/watch/places', body);
    if (result.ok)
      state = {
        ...state,
        draft: { label: state.draft.label, radius: state.draft.radius },
      };
    apply(
      result,
      result.ok
        ? `Added. You'll get an alert for incidents within ${milesText(body.radiusMiles)}.`
        : '',
    );
  };

  panel.addEventListener('input', (event) => {
    const t = event.target;
    if (!t?.closest?.('[data-act="add"]')) return;
    const key = {
      'gev-watch-label': 'label',
      'gev-watch-name': 'name',
      'gev-watch-address': 'address',
      'gev-watch-radius': 'radius',
    }[t.id];
    if (key)
      state = {
        ...state,
        draft: {
          ...state.draft,
          [key]: key === 'radius' ? Number(t.value) : t.value,
        },
      };
    if (key === 'label') render(); // the name hint follows the kind of place
  });

  panel.addEventListener('change', async (event) => {
    const t = event.target;
    if (t?.dataset?.act !== 'radius') return;
    const r = Number(t.value);
    apply(
      await api('POST', `/api/watch/places/${t.dataset.id}`, {
        radiusMiles: r,
      }),
      `Alert distance set to ${milesText(r)}.`,
    );
  });

  panel.addEventListener('submit', async (event) => {
    if (!event.target?.matches?.('[data-act="add"]')) return;
    event.preventDefault();
    const d = state.draft;
    const address = String(
      panel.querySelector('#gev-watch-address')?.value ?? d.address ?? '',
    ).trim();
    if (!address)
      return tell('Type a street address, or use where you are now.');
    await addPlace({
      label:
        panel.querySelector('#gev-watch-label')?.value ||
        d.label ||
        FALLBACK_LABEL,
      name:
        String(
          panel.querySelector('#gev-watch-name')?.value ?? d.name ?? '',
        ).trim() || undefined,
      address,
      radiusMiles: Number(
        panel.querySelector('#gev-watch-radius')?.value ?? d.radius ?? 0.5,
      ),
    });
  });

  panel.addEventListener('click', async (event) => {
    const el = event.target?.closest?.('[data-act]');
    const act = el?.dataset?.act;
    if (!act) return;
    if (act === 'close') return close();
    if (act === 'remove') {
      apply(
        await api('DELETE', `/api/watch/places/${el.dataset.id}`, {}),
        'Removed.',
      );
      return;
    }
    if (act === 'here') {
      const geo = nav?.geolocation;
      if (!geo) return tell('This browser cannot share its location.');
      tell('Finding where you are…');
      geo.getCurrentPosition(
        (pos) =>
          void addPlace({
            label:
              panel.querySelector('#gev-watch-label')?.value ||
              state.draft.label ||
              FALLBACK_LABEL,
            name:
              String(
                panel.querySelector('#gev-watch-name')?.value ?? '',
              ).trim() || undefined,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            radiusMiles: Number(
              panel.querySelector('#gev-watch-radius')?.value ?? 0.5,
            ),
          }),
        () => tell('Location was not shared. Type the address instead.'),
        { enableHighAccuracy: true, timeout: 15_000 },
      );
      return;
    }
    if (act === 'push-on') {
      try {
        const reg = await nav.serviceWorker.register(PUSH_WORKER_PATH);
        const permission = await win.Notification.requestPermission();
        if (permission !== 'granted') {
          state = {
            ...state,
            push: permission === 'denied' ? 'denied' : 'off',
          };
          return tell('Alerts were not allowed.');
        }
        const sub =
          (await reg.pushManager.getSubscription()) ||
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(state.data.pushKey),
          }));
        const result = await api('POST', '/api/watch/devices', {
          subscription: sub.toJSON(),
        });
        if (result.ok) state = { ...state, push: 'on' };
        apply(result, 'Alerts are on for this device.');
      } catch {
        tell('Alerts could not be turned on in this browser.');
      }
      return;
    }
    if (act === 'push-off') {
      const reg = await registration();
      const sub = await reg?.pushManager?.getSubscription?.();
      if (sub) {
        await api('DELETE', '/api/watch/devices', { endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => {});
      }
      state = { ...state, push: 'off' };
      return tell('Alerts are off for this device.');
    }
    if (act === 'test') {
      apply(
        await api('POST', '/api/watch/test', {}),
        'Test alert sent. It should appear in a few seconds.',
      );
    }
  });

  const onKey = (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopImmediatePropagation();
      close();
    }
  };
  const view = doc.defaultView || globalThis;
  view.addEventListener('keydown', onKey, true);

  return {
    open,
    dispose() {
      view.removeEventListener('keydown', onKey, true);
      panel.remove();
    },
  };
}
