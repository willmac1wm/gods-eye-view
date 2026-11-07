import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import {
  MOBILE_SHELL_CLASS,
  MOBILE_SHELL_MEDIA_QUERY,
  MOBILE_TABS,
  nextSheet,
  sheetForPanelId,
} from './ui/mobileShell.js';

test('index.html has no phone→/ops globe gate (mobileShell owns phones)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /gev-phone-globe-gate/);
  assert.doesNotMatch(html, /phoneGlobeGate/);
  assert.doesNotMatch(html, /shouldRoutePhoneToOps/);
  assert.doesNotMatch(html, /location\.replace\(.*\/ops\//);
  assert.match(html, /src\/main\.js/);
});

test('phoneGlobeGate module is removed', () => {
  assert.equal(existsSync(new URL('./phoneGlobeGate.js', import.meta.url)), false);
  assert.equal(
    existsSync(new URL('./phoneGlobeGate.test.mjs', import.meta.url)),
    false,
  );
});

test('ops shell has no phone-gate banner wiring', () => {
  const shell = readFileSync(new URL('./ops/shell.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./ops/ops.css', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /mountPhoneGlobeNotice|preferGlobeSession|phoneGlobeGate/);
  assert.doesNotMatch(css, /\.ops-phone-gate/);
  assert.match(shell, /href="\/"/);
});

test('mobileShell remains the ≤720px phone UI', () => {
  assert.equal(MOBILE_SHELL_MEDIA_QUERY, '(max-width: 720px)');
  assert.equal(MOBILE_SHELL_CLASS, 'mobile-shell');
  assert.ok(MOBILE_TABS.length >= 5);
  assert.equal(nextSheet(null, 'layers'), 'layers');
  assert.equal(nextSheet('layers', 'layers'), null);
  assert.equal(sheetForPanelId('data-panel'), 'layers');
  const css = readFileSync(
    new URL('./ui/styles/mobile-shell.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /mobile-shell/);
  assert.match(css, /720px/);
});
