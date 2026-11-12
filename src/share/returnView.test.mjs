import test from 'node:test';
import assert from 'node:assert/strict';
import {
  capeMayViewHash,
  hashCameraIsValid,
  landingAfterSignIn,
  rememberValidView,
  sanitizeReturnTarget,
  signInHref,
  viewHashAfterReturn,
} from './returnView.js';

const SAVED = 'v=2&lat=39.1000&lon=-74.8000&alt=12000&heading=10&pitch=-40&roll=0';
const ZERO = 'v=2&lat=0.0000&lon=-0.0000&alt=3500&heading=360&pitch=-90&roll=0';

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test('sign-in leaves with a valid view and comes back to it', () => {
  const store = memory();
  const href = signInHref(
    { hash: `#${SAVED}` },
    store,
  );
  const next = decodeURIComponent(href.slice(href.indexOf('next=') + 5));
  assert.equal(hashCameraIsValid(next), true);
  assert.match(next, /lat=39\.1000/);
  // The round trip: auth page, then a return with no hash.
  assert.equal(
    landingAfterSignIn('/', store),
    `/#${SAVED}`,
  );
  // A return that kept the valid hash still uses it.
  assert.equal(
    landingAfterSignIn(`/#${SAVED}`, store),
    `/#${SAVED}`,
  );
});

test('a return with no hash or a null-island hash never lands on 0,0', () => {
  const store = memory();
  rememberValidView(SAVED, store);
  assert.equal(viewHashAfterReturn({ hash: '', saved: SAVED }), SAVED);
  assert.equal(viewHashAfterReturn({ hash: ZERO, saved: SAVED }), SAVED);
  assert.equal(landingAfterSignIn(`/#${ZERO}`, store), `/#${SAVED}`);
  assert.equal(landingAfterSignIn('/', store), `/#${SAVED}`);
  assert.equal(landingAfterSignIn('https://app.capemaydispatch.com/auth/google/callback', store), `/#${SAVED}`);

  const empty = memory();
  const fallback = landingAfterSignIn('/#v=2&lat=0&lon=0', empty);
  assert.equal(fallback, `/#${capeMayViewHash()}`);
  assert.equal(hashCameraIsValid(fallback), true);
  assert.doesNotMatch(fallback, /lat=0/);
});

test('return targets reject open redirects and null-island coordinates', () => {
  assert.equal(sanitizeReturnTarget('https://evil.example/phish'), '/');
  assert.equal(sanitizeReturnTarget('//evil.example'), '/');
  assert.equal(
    sanitizeReturnTarget('/#v=2&lat=38.9350&lon=-74.9100&alt=45000&heading=0&pitch=-89&roll=0'),
    '/#v=2&lat=38.9350&lon=-74.9100&alt=45000&heading=0&pitch=-89&roll=0',
  );
  const stripped = sanitizeReturnTarget(`/?lat=0&lon=-0#${ZERO}`);
  assert.equal(stripped.includes('lat=0'), false);
  assert.equal(hashCameraIsValid(ZERO), false);
});
