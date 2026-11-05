import { GLOBE_COVERED, OPS_PAGES, POLICY_SKIP } from './catalog.js';
import { mountOpsShell } from './shell.js';
import { esc, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'hub' });

const cards = document.querySelector('#hub-cards');
cards.innerHTML = OPS_PAGES.filter((p) => p.id !== 'hub')
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
