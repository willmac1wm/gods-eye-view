import { mountOpsShell, setStatus } from './shell.js';
import { listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'scenes' });

const statusEl = document.querySelector('#status');
const libraryEl = document.querySelector('#library');
const uploadEl = document.querySelector('#upload');

libraryEl.innerHTML = listHtml([
  'GEV Director scenes (repo / authored packs) open on the globe — same engine as Space Missions / event reconstruct.',
  'Cape splat library slots: drop Fire Wire <code>/scenes</code> manifests here when published.',
  '<a href="/">Open globe Director</a>',
]);

uploadEl.innerHTML = note(
  'Upload / import UI binds to Fire Wire scene storage when the host exposes it. Local .gev scene files already import through the globe Director.',
);

setStatus(
  statusEl,
  'Scenes desk ready — library fills as Cape packs are published',
  'ok',
);
