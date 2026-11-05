import { capeGet, fetchGnss } from './api.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
  writePointUrl,
} from './shell.js';
import { esc, kv, listHtml } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'aviation' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const goBtn = document.querySelector('#go');
const statusEl = document.querySelector('#status');
const metarEl = document.querySelector('#metar');
const tfrsEl = document.querySelector('#tfrs');
const airEl = document.querySelector('#air');
const gnssEl = document.querySelector('#gnss');
const atcEl = document.querySelector('#atc');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  goBtn.disabled = true;
  setStatus(statusEl, 'Loading aviation desk…');
  try {
    if (Number.isFinite(lat) && Number.isFinite(lon)) writePointUrl(lat, lon);
    const [wx, tfrs, air, gnss] = await Promise.all([
      capeGet('airport_wx'),
      capeGet('aviation/tfrs'),
      capeGet('air'),
      fetchGnss(
        Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : {},
      ),
    ]);

    const airports = Array.isArray(wx)
      ? wx
      : wx?.airports || wx?.stations || wx?.items || [];
    metarEl.innerHTML = listHtml(
      airports.slice(0, 30).map((a) => {
        const id = a.icao || a.id || a.station || 'APT';
        const cat = a.flight_category || a.flightCategory || a.cat || '';
        const meta = a.raw || a.metar || a.summary || '';
        return `<b>${esc(id)}</b>${cat ? ` (${esc(cat)})` : ''}${meta ? ` — ${esc(meta)}` : ''}`;
      }),
    );

    const tfrList = Array.isArray(tfrs) ? tfrs : tfrs?.tfrs || tfrs?.items || [];
    tfrsEl.innerHTML = listHtml(
      tfrList.slice(0, 30).map((t) => {
        const title = t.name || t.title || t.id || 'TFR';
        const when = [t.start, t.end].filter(Boolean).join(' → ');
        return `<b>${esc(title)}</b>${when ? ` — ${esc(when)}` : ''}`;
      }),
    );

    airEl.innerHTML = air
      ? kv(
          Object.entries(air)
            .filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v))
            .slice(0, 16)
            .map(([k, v]) => [k, v]),
        )
      : '<p class="ops-note">Cape air snapshot unavailable</p>';

    gnssEl.innerHTML = gnss
      ? kv([
          ['Cells', gnss.count ?? gnss.cells?.length ?? gnss.features?.length],
          ['Status', gnss.status || gnss.state],
          ['Source', gnss.source],
          ['Note', 'Full GNSS integrity heat stays on the globe Events layer'],
        ])
      : '<p class="ops-note">GNSS integrity API quiet — enable globe Events → GNSS</p>';

    atcEl.innerHTML = listHtml([
      'Live ADS-B / squawk / type / registration: globe Movement layers',
      'ATC freqs & audio: attach when Fire Wire publishes <code>/api/cape</code> ATC routes',
      'Filed flight plans: dossier panel when aircraft/details enrichment is configured',
      `<a href="/">Open globe aviation layers</a>`,
    ]);

    setStatus(
      statusEl,
      [
        airports.length ? `${airports.length} METAR` : null,
        tfrList.length ? `${tfrList.length} TFR` : null,
        air ? 'air' : null,
        gnss ? 'GNSS' : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'waiting on Fire Wire / globe layers',
      airports.length || tfrList.length ? 'ok' : '',
    );
  } finally {
    goBtn.disabled = false;
  }
}

goBtn.addEventListener('click', () => void load());
void load();
setInterval(load, 60_000);
