import { capeGet } from './api.js';
import { globeHref } from './globeLinks.js';
import { startLiveDesk } from './liveDesk.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'cameras' });

const statusEl = document.querySelector('#status');
const camsEl = document.querySelector('#cams');

function collect(payload, bucket) {
  const lists = [
    payload?.cameras,
    payload?.items,
    Array.isArray(payload) ? payload : null,
  ].filter(Boolean);
  for (const list of lists) {
    for (const cam of list) bucket.push(cam);
  }
}

void startLiveDesk(
  'cameras',
  async () => {
    setStatus(statusEl, 'Loading camera directory…');
    const [traffic, nj511, fx, webcams] = await Promise.all([
      capeGet('traffic_cameras'),
      capeGet('intel/nj511_cameras'),
      capeGet('fx/cameras'),
      capeGet('webcams'),
    ]);
    const all = [];
    collect(traffic, all);
    collect(nj511, all);
    collect(fx, all);
    collect(webcams, all);

    camsEl.innerHTML = listHtml(
      all.slice(0, 80).map((cam) => {
        const title =
          cam.name || cam.title || cam.id || cam.camera_id || 'Camera';
        const kind = cam.source || cam.agency || cam.type || '';
        const lat = Number(cam.lat ?? cam.latitude);
        const lon = Number(cam.lon ?? cam.lng ?? cam.longitude);
        const globe =
          Number.isFinite(lat) && Number.isFinite(lon)
            ? ` · <a href="${globeHref({ lat, lon, layers: ['cape-cameras', 'cape-webcams'], panel: 'cctv' })}">Globe / CCTV</a>`
            : ' · <a href="/">Globe CCTV panel</a>';
        return `<b>${esc(title)}</b>${kind ? ` — ${esc(kind)}` : ''}${globe}`;
      }),
    );

    if (!all.length) {
      setStatus(
        statusEl,
        'No Fire Wire camera catalog — ferry/public cams still on globe CCTV',
        '',
      );
      return { source: 'cape/cameras', stale: true };
    }
    setStatus(statusEl, `${all.length} camera(s) in directory`, 'ok');
    return { source: 'cape/cameras' };
  },
  { defaultMs: 120_000, statusEl },
);
