/**
 * Watched places: a signed-in member's addresses (home, a second home, a
 * relative's or a friend's house…), each with a radius, and a push alert
 * when an incident is reported inside it.
 *
 *   GET    /api/watch                 places, choices, device count, push key
 *   POST   /api/watch/places          { label, name?, address | lat+lon, radiusMiles }
 *   POST   /api/watch/places/<id>     { radiusMiles?, label?, name? }
 *   DELETE /api/watch/places/<id>
 *   POST   /api/watch/devices         { subscription }  this browser's push subscription
 *   DELETE /api/watch/devices         { endpoint }
 *   POST   /api/watch/test            a test alert to this member's devices
 *
 * Every route needs the session's own stored account (getSessionAccount,
 * matched by id). Writes must be JSON, which a cross-site form cannot send
 * without a CORS preflight this server never answers, and are rate-limited.
 *
 * Privacy: addresses and coordinates stay in this server's data directory,
 * keyed by account id, and are never logged. A push names the place by the
 * member's own label and gives the distance; it never contains the address.
 * Members whose account no longer exists are dropped on the next sweep.
 *
 * Addresses are looked up with the U.S. Census Bureau geocoder (free, no
 * key, U.S. street addresses). The site's general place search uses a
 * separate Nominatim gate that is not configured in production.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { getSessionAccount, loadAccountStore } from './auth.js';
import { makeRateLimiter } from '../../../src/sources/rateLimit.js';
import { clientKey } from '../common/rate-limit.js';

export const WATCH_RADII_MILES = Object.freeze([0.1, 0.25, 0.5, 0.75, 1, 2, 5]);
export const WATCH_DEFAULT_RADIUS = 0.5;
export const WATCH_LABELS = Object.freeze([
  'Home',
  'Second home',
  'Family',
  'Friend',
  'Work',
  'Other',
]);
export const WATCH_MAX_PLACES = 10;
const MAX_DEVICES = 10;
/** A point incident older than this is history, not news. */
const FRESH_MS = 90 * 60 * 1000;
/** Keep "already sent" keys this long so an incident never alerts twice. */
const SENT_KEEP_MS = 3 * 24 * 3600 * 1000;
/** At most this many alerts per member per hour; the rest are recorded quietly. */
const HOURLY_CAP = 8;
const MATCH_EVERY_MS = 2 * 60 * 1000;
const EARTH_MILES = 3958.8;
const PUSH_SUBJECT = 'mailto:support@capemaydispatch.com';
const CENSUS_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

const dataDir = (env = process.env) =>
  env.GEV_DATA_DIR
    ? path.resolve(env.GEV_DATA_DIR)
    : path.join(process.cwd(), '.gev-data');

// ---------------------------------------------------------------- storage

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadWatchStore(env = process.env) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dataDir(env), 'watch-list.json'), 'utf8'),
    );
    if (raw && typeof raw.members === 'object') return raw;
  } catch {
    /* none yet */
  }
  return { version: 1, members: {} };
}

export function saveWatchStore(store, env = process.env) {
  writePrivate(path.join(dataDir(env), 'watch-list.json'), store);
}

const memberOf = (store, id) =>
  (store.members[String(id)] ??= { places: [], devices: [], sent: {} });

/** The push signing keys, made once and kept private in the data directory. */
export function pushKeys(env = process.env) {
  const file = path.join(dataDir(env), 'watch-push-keys.json');
  try {
    const keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (keys?.publicKey && keys?.privateKey) return keys;
  } catch {
    /* make them below */
  }
  const keys = webpush.generateVAPIDKeys();
  writePrivate(file, keys);
  return keys;
}

// ---------------------------------------------------------------- geometry

const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function milesBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting point-in-polygon over [lon, lat] rings. */
export function insideRings(point, rings) {
  let inside = false;
  for (const ring of rings || []) {
    if (!Array.isArray(ring)) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > point.lat !== yj > point.lat &&
        point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
      )
        inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------- input

const clean = (value, max) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  return text && [...text].length <= max ? text : null;
};

export function parseRadius(value) {
  const r = Number(value);
  return WATCH_RADII_MILES.includes(r) ? r : null;
}

export function parseLabel(value) {
  return WATCH_LABELS.includes(value) ? value : null;
}

/** Look an address up with the U.S. Census Bureau geocoder. */
export async function geocodeAddress(address, { fetchImpl = fetch } = {}) {
  const url = `${CENSUS_URL}?${new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json',
  })}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Census geocoder HTTP ${response.status}`);
    const body = await response.json();
    const match = body?.result?.addressMatches?.[0];
    const lon = Number(match?.coordinates?.x);
    const lat = Number(match?.coordinates?.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, matched: String(match.matchedAddress || address) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- incidents

const pointOf = (f) =>
  f?.geometry?.type === 'Point' &&
  Number.isFinite(f.geometry.lat) &&
  Number.isFinite(f.geometry.lon)
    ? { lat: f.geometry.lat, lon: f.geometry.lon }
    : null;

const FLOODING = new Set(['minor', 'moderate', 'major']);

/** "until Wed 6:00 PM" in Eastern time, or '' when there is no end. */
function untilText(iso) {
  const at = new Date(iso || '');
  if (Number.isNaN(at.getTime())) return '';
  return `until ${new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at)}`;
}

/**
 * The incidents worth an alert, from the local source envelopes: police,
 * fire and EMS calls, traffic incidents, approved community reports, tide
 * gauges at minor flooding or worse, and NWS warnings (by their area).
 */
export function incidentsFrom(envelopes = {}, now = Date.now()) {
  const out = [];
  const fresh = (iso) => {
    const t = Date.parse(iso || '');
    return !Number.isFinite(t) || now - t <= FRESH_MS;
  };
  const points = (env, kind, describe, keep = () => true) => {
    for (const f of env?.features || []) {
      const at = pointOf(f);
      if (!at || !f.id || !keep(f) || !fresh(f.observedAt)) continue;
      out.push({ id: String(f.id), kind, ...describe(f), at });
    }
  };
  points(envelopes.calls, 'call', (f) => ({
    title: f.title || 'Police, fire or EMS call',
    detail: [f.location, f.municipality].filter(Boolean).join(', '),
  }));
  points(envelopes.traffic, 'traffic', (f) => ({
    title: f.title || 'Traffic incident',
    detail: f.road || f.from || '',
  }));
  points(envelopes.reports, 'report', (f) => ({
    title: f.title || 'Community report',
    detail: f.status === 'verified' ? 'verified' : 'unverified',
  }));
  points(
    envelopes.gauges,
    'flooding',
    (f) => ({
      title: `${String(f.observed.category).replace(/^\w/, (c) => c.toUpperCase())} flooding`,
      detail: f.title || 'tide gauge',
    }),
    (f) => FLOODING.has(String(f.observed?.category || '').toLowerCase()),
  );
  for (const f of envelopes.alerts?.features || []) {
    const event = String(f.event || f.title || '');
    if (!/warning/i.test(event) || !f.id) continue;
    const rings = f.geometry?.rings;
    if (!Array.isArray(rings) || !rings.length) continue;
    out.push({
      id: String(f.id),
      kind: 'warning',
      title: f.title || event,
      detail: untilText(f.expires),
      rings,
    });
  }
  return out;
}

const formatMiles = (miles) =>
  miles < 0.1 ? 'under 0.1 mi' : `${miles.toFixed(miles < 1 ? 2 : 1)} mi`;

/**
 * Which alerts go out this sweep. Pure: takes the store and incidents,
 * returns the pushes to send and updates `sent` in place so the same
 * incident never alerts the same place twice.
 */
export function planAlerts(store, incidents, now = Date.now()) {
  const pushes = [];
  for (const [id, member] of Object.entries(store.members)) {
    for (const [key, at] of Object.entries(member.sent || {}))
      if (now - at > SENT_KEEP_MS) delete member.sent[key];
    if (!member.places?.length || !member.devices?.length) continue;
    const lastHour = Object.values(member.sent).filter(
      (at) => now - at < 3600_000 && at > 0,
    ).length;
    let budget = Math.max(0, HOURLY_CAP - lastHour);
    for (const place of member.places) {
      for (const incident of incidents) {
        const key = `${place.id}|${incident.id}`;
        if (member.sent[key] !== undefined) continue;
        let where = null;
        if (incident.rings) {
          if (insideRings(place, incident.rings)) where = 'inside the area';
        } else {
          const miles = milesBetween(place, incident.at);
          if (miles <= place.radiusMiles) where = `${formatMiles(miles)} away`;
        }
        if (!where) continue;
        if (budget <= 0) {
          member.sent[key] = -now; // recorded quietly: over the hourly cap
          continue;
        }
        budget--;
        member.sent[key] = now;
        pushes.push({
          member: id,
          payload: {
            title: `Near ${place.name || place.label} · ${where}`,
            body: [incident.title, incident.detail].filter(Boolean).join(' · '),
            tag: key,
            kind: incident.kind,
            url: incident.at
              ? `/?lat=${incident.at.lat.toFixed(4)}&lon=${incident.at.lon.toFixed(4)}`
              : '/',
          },
        });
      }
    }
  }
  return pushes;
}

// ---------------------------------------------------------------- delivery

async function deliver(store, pushes, { env, sender }) {
  const keys = pushKeys(env);
  let changed = false;
  for (const { member, payload } of pushes) {
    const entry = store.members[member];
    for (const device of [...(entry?.devices || [])]) {
      try {
        await sender(device.subscription, JSON.stringify(payload), {
          TTL: 3600,
          urgency: 'high',
          vapidDetails: {
            subject: PUSH_SUBJECT,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
        });
      } catch (error) {
        // Gone or no longer valid: forget this device.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          entry.devices = entry.devices.filter((d) => d !== device);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** One sweep: incidents → alerts → pushes. Returns how many were sent. */
export async function runWatchSweep({
  env = process.env,
  now = Date.now(),
  loadEnvelopes,
  sender = (...args) => webpush.sendNotification(...args),
} = {}) {
  const store = loadWatchStore(env);
  // Drop members whose account has been deleted.
  const accounts = new Set(
    loadAccountStore(env).accounts.map((a) => String(a.id)),
  );
  for (const id of Object.keys(store.members))
    if (!accounts.has(id)) delete store.members[id];
  const active = Object.values(store.members).some(
    (m) => m.places?.length && m.devices?.length,
  );
  if (!active) {
    saveWatchStore(store, env);
    return 0;
  }
  const incidents = incidentsFrom(await loadEnvelopes(), now);
  const pushes = planAlerts(store, incidents, now);
  await deliver(store, pushes, { env, sender });
  saveWatchStore(store, env);
  return pushes.length;
}

// ---------------------------------------------------------------- routes

function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
            : {},
        );
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const publicPlace = (p) => ({
  id: p.id,
  label: p.label,
  name: p.name || null,
  address: p.address,
  lat: p.lat,
  lon: p.lon,
  radiusMiles: p.radiusMiles,
});

export function createWatchHandler({
  env = process.env,
  now = Date.now,
  fetchImpl = fetch,
  sender = (...args) => webpush.sendNotification(...args),
} = {}) {
  const allowWrite = makeRateLimiter({
    windowMs: 60_000,
    max: 20,
    globalMax: 400,
  });

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (pathname !== '/api/watch' && !pathname.startsWith('/api/watch/'))
      return false;

    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
      return true;
    };

    const user = getSessionAccount(req, { env, now });
    if (!user) return json(401, { error: 'Sign in to keep a watch list' });

    if (req.method !== 'GET') {
      if (
        !String(req.headers?.['content-type'] || '')
          .toLowerCase()
          .startsWith('application/json')
      )
        return json(415, { error: 'Send JSON' });
      if (!allowWrite(clientKey(req)))
        return json(429, { error: 'Too many changes. Please wait a minute.' });
    }

    const store = loadWatchStore(env);
    const member = memberOf(store, user.id);
    const view = () => ({
      places: member.places.map(publicPlace),
      devices: member.devices.length,
      radii: WATCH_RADII_MILES,
      labels: WATCH_LABELS,
      maxPlaces: WATCH_MAX_PLACES,
      pushKey: pushKeys(env).publicKey,
    });

    let body = {};
    if (req.method !== 'GET') {
      try {
        body = await readJson(req);
      } catch (error) {
        return json(400, { error: error.message });
      }
    }

    if (pathname === '/api/watch' && req.method === 'GET')
      return json(200, view());

    if (pathname === '/api/watch/places' && req.method === 'POST') {
      if (member.places.length >= WATCH_MAX_PLACES)
        return json(400, {
          error: `You can watch up to ${WATCH_MAX_PLACES} places`,
        });
      const label = parseLabel(body.label);
      const radiusMiles = parseRadius(body.radiusMiles ?? WATCH_DEFAULT_RADIUS);
      if (!label) return json(400, { error: 'Pick a label' });
      if (!radiusMiles) return json(400, { error: 'Pick a distance' });
      const name = body.name ? clean(body.name, 40) : null;
      if (body.name && !name)
        return json(400, { error: 'Use up to 40 characters for the name' });
      let spot = null;
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (
        body.address == null &&
        Number.isFinite(lat) &&
        Number.isFinite(lon)
      ) {
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180)
          return json(400, { error: 'That location is not valid' });
        spot = { lat, lon, matched: 'Location picked on this device' };
      } else {
        const address = clean(body.address, 200);
        if (!address) return json(400, { error: 'Type a street address' });
        try {
          spot = await geocodeAddress(address, { fetchImpl });
        } catch {
          return json(502, {
            error: 'The address lookup is not answering. Try again soon.',
          });
        }
        if (!spot)
          return json(404, {
            error:
              'That address was not found. Check the street, town and ZIP code.',
          });
      }
      const place = {
        id: crypto.randomUUID(),
        label,
        name,
        address: spot.matched,
        lat: spot.lat,
        lon: spot.lon,
        radiusMiles,
        createdAt: new Date(now()).toISOString(),
      };
      member.places.push(place);
      saveWatchStore(store, env);
      return json(200, { ok: true, place: publicPlace(place), ...view() });
    }

    const placeMatch = /^\/api\/watch\/places\/([0-9a-f-]{36})$/.exec(pathname);
    if (placeMatch) {
      const place = member.places.find((p) => p.id === placeMatch[1]);
      if (!place) return json(404, { error: 'That place is not on your list' });
      if (req.method === 'DELETE') {
        member.places = member.places.filter((p) => p !== place);
        for (const key of Object.keys(member.sent))
          if (key.startsWith(`${place.id}|`)) delete member.sent[key];
        saveWatchStore(store, env);
        return json(200, { ok: true, ...view() });
      }
      if (req.method === 'POST') {
        if (body.radiusMiles !== undefined) {
          const r = parseRadius(body.radiusMiles);
          if (!r) return json(400, { error: 'Pick a distance' });
          place.radiusMiles = r;
        }
        if (body.label !== undefined) {
          const l = parseLabel(body.label);
          if (!l) return json(400, { error: 'Pick a label' });
          place.label = l;
        }
        if (body.name !== undefined) {
          const n = body.name ? clean(body.name, 40) : null;
          if (body.name && !n)
            return json(400, { error: 'Use up to 40 characters for the name' });
          place.name = n;
        }
        saveWatchStore(store, env);
        return json(200, { ok: true, place: publicPlace(place), ...view() });
      }
    }

    if (pathname === '/api/watch/devices' && req.method === 'POST') {
      const sub = body.subscription;
      const endpoint = String(sub?.endpoint || '');
      const keys = sub?.keys || {};
      if (
        !/^https:\/\//.test(endpoint) ||
        endpoint.length > 1000 ||
        typeof keys.p256dh !== 'string' ||
        typeof keys.auth !== 'string' ||
        keys.p256dh.length > 200 ||
        keys.auth.length > 100
      )
        return json(400, { error: 'That push subscription is not valid' });
      member.devices = member.devices.filter(
        (d) => d.subscription.endpoint !== endpoint,
      );
      member.devices.push({
        subscription: {
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
        },
        addedAt: new Date(now()).toISOString(),
      });
      member.devices = member.devices.slice(-MAX_DEVICES);
      saveWatchStore(store, env);
      return json(200, { ok: true, ...view() });
    }

    if (pathname === '/api/watch/devices' && req.method === 'DELETE') {
      const endpoint = String(body.endpoint || '');
      member.devices = member.devices.filter(
        (d) => d.subscription.endpoint !== endpoint,
      );
      saveWatchStore(store, env);
      return json(200, { ok: true, ...view() });
    }

    if (pathname === '/api/watch/test' && req.method === 'POST') {
      if (!member.devices.length)
        return json(400, { error: 'Turn on alerts on this device first' });
      const changed = await deliver(
        store,
        [
          {
            member: String(user.id),
            payload: {
              title: 'Cape May Dispatch alerts are on',
              body: 'This is a test. Real alerts name your place and how far away the incident is.',
              tag: 'test',
              kind: 'test',
              url: '/',
            },
          },
        ],
        { env, sender },
      );
      if (changed) saveWatchStore(store, env);
      return json(200, { ok: true, ...view() });
    }

    return json(404, { error: 'Not Found' });
  };
}

const SWEEP_STARTED = Symbol.for('gev.watchList.sweep');

/**
 * Mount the routes, and start the sweep once per process unless
 * GEV_WATCH_ALERTS=0.
 */
export function installWatchRoutes(
  server,
  { env = process.env, loadEnvelopes } = {},
) {
  const handle = createWatchHandler({ env });
  server.middlewares.use((req, res, next) => {
    Promise.resolve(handle(req, res))
      .then((handled) => {
        if (!handled) next();
      })
      .catch(() => {
        if (!res.writableEnded) {
          res.writeHead(500, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: 'Watch list service error' }));
        }
      });
  });
  if (
    env.GEV_WATCH_ALERTS === '0' ||
    !loadEnvelopes ||
    globalThis[SWEEP_STARTED]
  )
    return;
  globalThis[SWEEP_STARTED] = true;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runWatchSweep({ env, loadEnvelopes })
      .catch((error) => console.warn('[Watch] sweep failed:', error?.message))
      .finally(() => {
        running = false;
      });
  }, MATCH_EVERY_MS);
  timer.unref?.();
}
