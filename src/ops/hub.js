import { GLOBE_COVERED, OPS_PAGES, POLICY_SKIP } from './catalog.js';
import { deskVisible, fetchOpsConfig } from './config.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell } from './shell.js';
import { esc, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'hub' });

const health = createPageHealth(ensureHealthHost(), {
  desk: 'hub',
  pollMs: 300_000,
});

void (async () => {
  const config = await fetchOpsConfig();
  await health.probe(async () => {
    const cards = document.querySelector('#hub-cards');
    cards.innerHTML = OPS_PAGES.filter(
      (p) => p.id !== 'hub' && deskVisible(config, p.id),
    )
      .map(
        (p) => `<a href="${p.href}">
      <strong>${esc(p.title)}</strong>
      <span>${esc(p.blurb)}${p.old ? ` · was ${esc(p.old)}` : ''}</span>
    </a>`,
      )
      .join('');

    document.querySelector('#globe-covered').innerHTML = listHtml(
      GLOBE_COVERED.map(esc),
    );
    document.querySelector('#policy-skip').innerHTML = listHtml(
      POLICY_SKIP.map(esc),
    );
    return { source: 'catalog' };
  });
})();
