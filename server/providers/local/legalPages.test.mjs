import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleLegalRequest,
  renderPrivacyHtml,
  renderSupportHtml,
  renderTermsHtml,
} from './legalPages.js';
import { BROWSER_CSP } from '../../../build/vite.js';

function mockRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body = String(chunk || '');
    },
  };
}

test('/privacy, /support, and /terms return 200 HTML with BROWSER_CSP and App Store disclosures', () => {
  for (const [path, expectedHeading] of [
    ['/privacy', 'Privacy Policy'],
    ['/support', 'Support &amp; Help Center'],
    ['/terms', 'Terms of Use'],
    ['/privacy/', 'Privacy Policy'],
    ['/support?ref=appstore', 'Support &amp; Help Center'],
  ]) {
    const res = mockRes();
    const handled = handleLegalRequest({ method: 'GET', url: path }, res);
    assert.equal(handled, true, path);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['Content-Security-Policy'], BROWSER_CSP);
    assert.equal(res.headers['X-Frame-Options'], 'DENY');
    assert.ok(res.body.includes(expectedHeading), `missing heading in ${path}`);
    assert.ok(res.body.includes('<!--email_off-->'), `missing email_off marker in ${path}`);
    assert.ok(res.body.includes('support@capemaydispatch.com'), `missing contact email in ${path}`);
    assert.ok(res.body.includes('9-1-1'), `missing 9-1-1 safety banner in ${path}`);
    assert.ok(!/<script\b/i.test(res.body), `no inline script allowed in ${path}`);
  }
});

test('/privacy includes Firebase cape-dispatch and self-service account deletion instructions', () => {
  const html = renderPrivacyHtml();
  assert.ok(html.includes('cape-dispatch'));
  assert.ok(html.includes('Delete My Account Permanently'));
  assert.ok(html.includes('/account'));
});

test('/support includes Google and Apple sign-in and incident link guidance', () => {
  const html = renderSupportHtml();
  assert.ok(html.includes('Continue with Google'));
  assert.ok(html.includes('Continue with Apple'));
  assert.ok(html.includes('/incidents/{id}'));
});

test('HEAD /privacy returns 200 with empty body and POST /privacy returns 405', () => {
  const headRes = mockRes();
  assert.equal(handleLegalRequest({ method: 'HEAD', url: '/privacy' }, headRes), true);
  assert.equal(headRes.status, 200);
  assert.equal(headRes.body, '');

  const postRes = mockRes();
  assert.equal(handleLegalRequest({ method: 'POST', url: '/privacy' }, postRes), true);
  assert.equal(postRes.status, 405);
  assert.equal(postRes.headers.Allow, 'GET, HEAD');

  const otherRes = mockRes();
  assert.equal(handleLegalRequest({ method: 'GET', url: '/api/local/conditions' }, otherRes), false);
});

test('/guide serves the field guide: static, no scripts, no server settings, same headers', () => {
  const res = mockRes();
  assert.equal(handleLegalRequest({ method: 'GET', url: '/guide' }, res), true);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['Content-Security-Policy'], BROWSER_CSP);
  assert.match(res.body, /^<!DOCTYPE html>/);
  assert.match(res.body, /<title>Cape May Dispatch Field Guide<\/title>/);
  for (const section of ['colors', 'aviation', 'weather', 'ocean', 'roads', 'safety', 'hazards', 'more', 'tools', 'situations', 'routine'])
    assert.match(res.body, new RegExp(`<section id="${section}">`), section);
  assert.ok(!/<script\b/i.test(res.body), 'no scripts: script-src is self only');
  // Nothing that goes stale or shows how the server is set up.
  assert.ok(!/_API_KEY|_TOKEN|_SECRET|Legion|\/ops\//.test(res.body));
  assert.ok(!/id="(now|keys|hidden)"/.test(res.body));
  // The fonts it asks for are ones BROWSER_CSP allows.
  for (const host of res.body.matchAll(/https:\/\/(fonts\.[a-z]+\.com)/g))
    assert.ok(BROWSER_CSP.includes(host[1]), host[1]);
});

test('every legal page links to the field guide', () => {
  for (const path of ['/privacy', '/support', '/terms']) {
    const res = mockRes();
    handleLegalRequest({ method: 'GET', url: path }, res);
    assert.match(res.body, /href="\/guide"/, path);
  }
});
