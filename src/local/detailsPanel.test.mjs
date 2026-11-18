import test from 'node:test';
import assert from 'node:assert/strict';
import { detailsHtml } from './detailsPanel.js';

test('a record’s links render as new-tab buttons under their label', () => {
  const html = detailsHtml({
    title: 'Gas $4.06',
    status: 'official',
    linksLabel: 'Local station prices',
    links: [
      { label: 'Station prices on GasBuddy ↗', href: 'https://www.gasbuddy.com/x' },
      { label: 'Maps & more', href: 'https://www.google.com/maps/search/?api=1&query=a%20b' },
    ],
  });
  assert.match(html, /<span class="gev-local-label">Local station prices<\/span>/);
  assert.match(
    html,
    /<a class="gev-local-btn" href="https:\/\/www\.gasbuddy\.com\/x" target="_blank" rel="noopener noreferrer">Station prices on GasBuddy ↗<\/a>/,
  );
  // Labels and hrefs are escaped.
  assert.match(html, />Maps &amp; more</);
  assert.match(html, /query=a%20b/);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query/);
});

test('only labelled absolute http(s) links render', () => {
  const html = detailsHtml({
    title: 'x',
    links: [
      { label: 'script', href: 'javascript:alert(1)' },
      { label: 'data', href: 'data:text/html,hi' },
      { label: 'relative', href: '/api/fuel' },
      { label: '', href: 'https://example.com/unlabelled' },
      { label: 'ok', href: 'HTTPS://example.com/ok' },
      null,
    ],
  });
  assert.doesNotMatch(html, /javascript:|data:text|\/api\/fuel|unlabelled/);
  assert.match(html, /href="HTTPS:\/\/example\.com\/ok"/);
  assert.equal(html.match(/class="gev-local-links"/g).length, 1);
});

test('a record without links renders no link block, and fly follows canFly', () => {
  const html = detailsHtml({ title: 'x', link: 'https://example.com/source' });
  assert.doesNotMatch(html, /gev-local-links/);
  assert.match(html, /Open source ↗/);
  assert.doesNotMatch(html, /data-act="fly"/);
  assert.match(detailsHtml({ title: 'x' }, { canFly: true }), /data-act="fly"/);
});
