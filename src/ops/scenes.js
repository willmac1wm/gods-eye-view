import { packsByKind } from './fixtures/capePacks.js';
import { globeHref } from './globeLinks.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'scenes' });

const statusEl = document.querySelector('#status');
const libraryEl = document.querySelector('#library');
const uploadEl = document.querySelector('#upload');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'scenes',
  pollMs: 300_000,
});

const packs = packsByKind('scene');

libraryEl.innerHTML = listHtml([
  'GEV Director scenes (repo / authored packs) open on the globe — same engine as Space Missions / event reconstruct.',
  ...packs.map((pack) => {
    const globe = globeHref({
      lat: pack.lat,
      lon: pack.lon,
      layers: [...pack.layers],
    });
    const assets =
      pack.assets?.length > 0
        ? `${pack.assets.length} asset(s)`
        : 'author assets empty';
    return (
      `<b>${esc(pack.title)}</b> · ${esc(pack.id)} · ${esc(assets)}` +
      ` · <a href="${globe}">Open on globe</a>` +
      (pack.note ? `<br/><span class="ops-note">${esc(pack.note)}</span>` : '')
    );
  }),
  'Cape splat library slots: drop Fire Wire <code>/scenes</code> manifests here when published.',
  '<a href="/">Open globe Director</a>',
]);

uploadEl.innerHTML = note(
  'Upload / import UI binds to Fire Wire scene storage when the host exposes it. Local .gev scene files already import through the globe Director. Starter packs above are shells — they load without error with empty author assets.',
);

health.probe(async () => {
  setStatus(
    statusEl,
    `${packs.length} Cape starter pack shell(s) · author assets empty until published`,
    'ok',
  );
  return { source: 'cape-starter-packs' };
});
