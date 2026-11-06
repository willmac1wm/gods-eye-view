import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIVEATC_AIRPORTS,
  liveatcLinksEnabled,
  liveatcListHtml,
} from './liveatc.js';

test('LiveATC catalog includes KWWD and nearby Cape ATC', () => {
  const icaos = LIVEATC_AIRPORTS.map((a) => a.icao);
  assert.ok(icaos.includes('KWWD'));
  assert.ok(icaos.includes('KACY'));
  assert.ok(icaos.includes('KMIV'));
  for (const apt of LIVEATC_AIRPORTS) {
    assert.match(apt.searchUrl, /^https:\/\/www\.liveatc\.net\//);
    assert.match(apt.airportUrl, /^https:\/\/www\.liveatc\.net\//);
  }
});

test('liveatcLinksEnabled defaults on and honors Managers toggle', () => {
  assert.equal(liveatcLinksEnabled(null), true);
  assert.equal(liveatcLinksEnabled({ sources: {} }), true);
  assert.equal(
    liveatcLinksEnabled({ sources: { liveatc: { links: false } } }),
    false,
  );
});

test('liveatcListHtml marks external link-outs', () => {
  const html = liveatcListHtml((s) => s).join('\n');
  assert.match(html, /KWWD/);
  assert.match(html, /external/);
  assert.match(html, /target="_blank"/);
});
