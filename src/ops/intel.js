import { parseKmlOrKmz } from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'intel' });

const statusEl = document.querySelector('#status');
const toolsEl = document.querySelector('#tools');
const parseBtn = document.querySelector('#parse');
const fileInput = document.querySelector('#kml');
const outEl = document.querySelector('#kml-out');

toolsEl.innerHTML = listHtml([
  '<b>TDOA</b> — acoustic time-difference locator (needs multi-receiver Fire Wire audio)',
  '<b>Doppler</b> — audio Doppler analysis on scanner / SDR chunks',
  '<b>Webcam FFT</b> — motion / flicker spectrum from CCTV stills',
  '<b>Dark targets</b> — low-observable track assist on globe Movement layers',
  '<b>Maven</b> — structured intel brief merge into HUD chat',
  '<b>KMZ / KML parse</b> — ready below (native ops compile)',
]);

setStatus(
  statusEl,
  'Intel lab online — KMZ parse live; acoustic/vision tools wait on Fire Wire media',
  'ok',
);

parseBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    outEl.innerHTML = note('Choose a .kml or .kmz file');
    return;
  }
  parseBtn.disabled = true;
  outEl.innerHTML = note('Parsing…');
  try {
    const result = await parseKmlOrKmz(file);
    outEl.innerHTML =
      kv([
        ['File', result.filename],
        ['Document', result.documentName],
        ['Placemarks', result.placemarkCount],
      ]) +
      listHtml(
        (result.placemarks || []).slice(0, 40).map((p) => {
          const link =
            Number.isFinite(p.lat) && Number.isFinite(p.lon)
              ? ` · <a href="/ops/place?lat=${p.lat}&lon=${p.lon}">Place</a> · <a href="/?lat=${p.lat}&lon=${p.lon}">Globe</a>`
              : '';
          return `<b>${esc(p.name)}</b>${p.lat != null ? ` — ${esc(p.lat)}, ${esc(p.lon)}` : ''}${link}`;
        }),
      );
    setStatus(statusEl, `Parsed ${result.placemarkCount} placemark(s)`, 'ok');
  } catch (error) {
    outEl.innerHTML = note(error.message || 'Parse failed');
    setStatus(statusEl, error.message || 'Parse failed', 'error');
  } finally {
    parseBtn.disabled = false;
  }
});
