import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHONE_GLOBE_SESSION_KEY,
  buildOpsRedirectUrl,
  preferGlobeSession,
  shouldRoutePhoneToOps,
} from './phoneGlobeGate.js';

function mq(matchesByQuery) {
  return (query) => ({ matches: Boolean(matchesByQuery[query]) });
}

test('shouldRoutePhoneToOps redirects narrow / coarse phones', () => {
  assert.equal(
    shouldRoutePhoneToOps({
      search: '',
      matchMedia: mq({ '(max-width: 720px)': true }),
    }),
    true,
  );
  assert.equal(
    shouldRoutePhoneToOps({
      search: '',
      matchMedia: mq({
        '(max-width: 720px)': false,
        '(hover: none) and (pointer: coarse)': true,
      }),
    }),
    true,
  );
  assert.equal(
    shouldRoutePhoneToOps({
      search: '',
      matchMedia: mq({
        '(max-width: 720px)': false,
        '(hover: none) and (pointer: coarse)': false,
      }),
    }),
    false,
  );
});

test('?globe=1 and session prefer-globe bypass the phone gate', () => {
  const store = {
    getItem: (k) => (k === PHONE_GLOBE_SESSION_KEY ? '1' : null),
  };
  assert.equal(
    shouldRoutePhoneToOps({
      search: '?globe=1',
      matchMedia: mq({ '(max-width: 720px)': true }),
    }),
    false,
  );
  assert.equal(
    shouldRoutePhoneToOps({
      search: '',
      sessionStorage: store,
      matchMedia: mq({ '(max-width: 720px)': true }),
    }),
    false,
  );
});

test('buildOpsRedirectUrl preserves lat/lon/z and sets from=globe', () => {
  assert.equal(
    buildOpsRedirectUrl('https://example.test/?lat=38.9&lon=-74.9&z=12'),
    '/ops/?from=globe&lat=38.9&lon=-74.9&z=12',
  );
  assert.equal(
    buildOpsRedirectUrl('https://example.test/?lat=38.9&lng=-74.9&zoom=10'),
    '/ops/?from=globe&lat=38.9&lon=-74.9&z=10',
  );
});

test('preferGlobeSession writes session key', () => {
  const mem = {};
  preferGlobeSession({
    setItem: (k, v) => {
      mem[k] = v;
    },
  });
  assert.equal(mem[PHONE_GLOBE_SESSION_KEY], '1');
});

test('index.html gates phones before main.js Cesium boot', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(path.join(root, '..', 'index.html'), 'utf8');
  const headGate = html.indexOf('gev-phone-globe-gate');
  const moduleGate = html.indexOf('shouldRoutePhoneToOps');
  const mainIdx = html.indexOf('src="/src/main.js"');
  assert.ok(headGate > 0, 'head phone gate marker missing');
  assert.ok(moduleGate > 0, 'module phone gate missing');
  assert.ok(moduleGate < mainIdx, 'module gate must run before main.js');
  assert.match(html, /from['"],\s*['"]globe['"]/);
  assert.match(html, /params\.get\(['"]globe['"]\) === ['"]1['"]/);
});
