import { capeGet, parseKmlOrKmz } from './api.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'intel' });

const statusEl = document.querySelector('#status');
const toolsEl = document.querySelector('#tools');
const acousticsEl = document.querySelector('#acoustics');
const parseBtn = document.querySelector('#parse');
const fileInput = document.querySelector('#kml');
const outEl = document.querySelector('#kml-out');

const health = createPageHealth(ensureHealthHost(), {
  desk: 'intel',
  pollMs: 300_000,
});

toolsEl.innerHTML = listHtml([
  '<b>TDOA</b> — acoustic time-difference locator (needs multi-receiver Fire Wire audio)',
  '<b>Doppler</b> — audio Doppler analysis on scanner / SDR chunks',
  '<b>Webcam FFT</b> — motion / flicker spectrum from CCTV stills',
  '<b>Dark targets</b> — low-observable track assist on globe Movement layers',
  '<b>Maven</b> — structured intel brief merge into HUD chat',
  '<b>KMZ / KML parse</b> — ready below (native ops compile)',
]);

async function probeAcoustics() {
  // Media routes documented in docs/FIREWIRE.md — radio/live + fw-audio.
  const radio = await capeGet('radio/feeds');
  const feeds = radio?.feeds || [];
  const withAudio = feeds.filter((f) => f.live || f.has_audio).length;
  const blocked = !radio || withAudio === 0;
  if (acousticsEl) {
    const rows = [
      blocked
        ? note(
            'TDOA / Doppler blocked-on-media — need Fire Wire SDR chunks on /api/cape/radio/live and /api/cape/fw-audio/…',
          )
        : note(
            `${withAudio} feed(s) report audio — acoustic tools can attach when multi-receiver packs publish.`,
          ),
      'Contract: same scanner audio paths as RADIO (see docs/FIREWIRE.md). GEV does not invent TDOA/Doppler results.',
      radio
        ? `Feeds registered: ${feeds.length} · with audio signal: ${withAudio}`
        : 'Fire Wire radio offline / unconfigured — set FIREWIRE_URL',
      '<a href="/ops/scanners">Scanners desk</a> · <a href="/">Globe RADIO</a>',
    ];
    acousticsEl.innerHTML = listHtml(rows);
  }
  return {
    source: radio ? 'cape/radio+kmz' : 'kmz-only',
    stale: blocked,
    blocked,
  };
}

void health.probe(async () => {
  const meta = await probeAcoustics();
  setStatus(
    statusEl,
    meta.blocked
      ? 'KMZ parse live · TDOA/Doppler blocked-on-media (waiting on Fire Wire SDR)'
      : 'Intel lab online — KMZ parse live; acoustic media present',
    'ok',
  );
  return meta;
});

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
