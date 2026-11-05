import { capeGet } from './api.js';
import { mountOpsShell, setStatus } from './shell.js';
import { esc, listHtml, fmtWhen } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'scanners' });

const statusEl = document.querySelector('#status');
const feedsEl = document.querySelector('#feeds');

async function load() {
  setStatus(statusEl, 'Loading Fire Wire feeds…');
  const radio = await capeGet('radio/feeds');
  const feeds = radio?.feeds || [];
  if (!radio) {
    setStatus(
      statusEl,
      'Fire Wire radio offline / unconfigured — set FIREWIRE_URL',
      'error',
    );
    feedsEl.innerHTML = listHtml([]);
    return;
  }
  feedsEl.innerHTML = listHtml(
    feeds.map((feed) => {
      const mark = feed.live
        ? 'LIVE'
        : feed.has_audio
          ? 'idle · SDR'
          : 'no audio · SDR';
      const heard = feed.last_heard_at
        ? ` · heard ${esc(fmtWhen(feed.last_heard_at))}`
        : '';
      const open = feed.feed_id != null
        ? ` · <a href="/?capeRadio=${encodeURIComponent(feed.feed_id)}">Open on globe RADIO</a>`
        : '';
      return `${esc(mark)} <b>${esc(feed.agency || feed.name)}</b> — ${esc(feed.desc || feed.name)}${heard}${open}`;
    }),
  );
  const live = feeds.filter((f) => f.live).length;
  setStatus(
    statusEl,
    feeds.length === 0
      ? 'quiet · waiting on SDR'
      : live
        ? `${live} live / ${feeds.length}`
        : `${feeds.length} idle · waiting on SDR`,
    'ok',
  );
}

void load();
setInterval(load, 30_000);
