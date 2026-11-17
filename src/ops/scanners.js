import { capeGet } from './api.js';
import { globeHref } from './globeLinks.js';
import { liveatcLinksEnabled, liveatcListHtml } from './liveatc.js';
import { fetchOpsConfig } from './config.js';
import { startLiveDesk } from './liveDesk.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml, fmtWhen, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'scanners' });

const statusEl = document.querySelector('#status');
const feedsEl = document.querySelector('#feeds');
const policyEl = document.querySelector('#policy');

let config = null;

function renderPolicy(feeds) {
  if (!policyEl) return;
  const rows = [
    note(
      'Quiet is healthy until station SDRs publish Fire Wire chunks. Opening RADIO on an idle feed shows “waiting on SDR” — Broadcastify is not used.',
    ),
    `Contract: <code>GET /api/cape/radio/feeds</code> · <code>/radio/live?feed_id=</code> · clip bytes under <code>/api/cape/fw-audio/…</code> (see docs/FIREWIRE.md).`,
    `<a href="${globeHref({ layers: ['cape-radio'] })}">Globe RADIO layer</a>`,
  ];
  if (!feeds?.length) {
    rows.push(
      note(
        'No feeds yet — in-app Fire Wire quiet store waiting on SDR ingest.',
      ),
    );
  }
  if (liveatcLinksEnabled(config)) {
    rows.push(
      note(
        'Aviation ATC listen-out (external only): LiveATC for KWWD / nearby — no in-app restream.',
      ),
      ...liveatcListHtml(esc).slice(0, 1),
      `<a href="/ops/aviation">Aviation desk</a>`,
    );
  }
  policyEl.innerHTML = listHtml(rows);
}

void (async () => {
  config = await fetchOpsConfig();
  void startLiveDesk(
    'scanners',
    async () => {
      setStatus(statusEl, 'Loading Fire Wire feeds…');
      const radio = await capeGet('radio/feeds');
      const feeds = radio?.feeds || [];
      if (!radio) {
        setStatus(
          statusEl,
          'Radio quiet — in-app Fire Wire waiting on SDR (not Broadcastify)',
          'error',
        );
        feedsEl.innerHTML = listHtml([]);
        renderPolicy([]);
        return { source: 'cape/radio', stale: true };
      }
      feedsEl.innerHTML = listHtml(
        feeds.map((feed) => {
          const mark = feed.live
            ? 'LIVE'
            : feed.has_audio
              ? 'idle · SDR chunk ready'
              : 'no audio · waiting on SDR';
          const heard = feed.last_heard_at
            ? ` · heard ${esc(fmtWhen(feed.last_heard_at))}`
            : '';
          const radioGlobe = globeHref({ layers: ['cape-radio'] });
          const open =
            feed.feed_id != null
              ? ` · <a href="${radioGlobe}${radioGlobe.includes('?') ? '&' : '?'}capeRadio=${encodeURIComponent(feed.feed_id)}">Open on globe RADIO</a>`
              : ` · <a href="${radioGlobe}">Globe radio layer</a>`;
          return `${esc(mark)} <b>${esc(feed.agency || feed.name)}</b> — ${esc(feed.desc || feed.name)}${heard}${open}`;
        }),
      );
      const live = feeds.filter((f) => f.live).length;
      const withAudio = feeds.filter((f) => f.has_audio || f.live).length;
      setStatus(
        statusEl,
        feeds.length === 0
          ? 'quiet · waiting on station SDR → Fire Wire chunks'
          : live
            ? `${live} live / ${feeds.length}`
            : withAudio
              ? `${feeds.length} feed(s) · ${withAudio} with chunks · idle`
              : `${feeds.length} feed(s) registered · no audio chunks yet (waiting on SDR)`,
        'ok',
      );
      renderPolicy(feeds);
      return { source: 'cape/radio' };
    },
    { defaultMs: 60_000, statusEl },
  );
})();
