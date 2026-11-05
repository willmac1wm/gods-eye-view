import { capeGet, fetchFloodZone, fetchHydrants, fetchPlace } from './api.js';
import {
  applyDeskViewability,
  fetchOpsConfig,
  intervalFor,
  placeSectionVisible,
} from './config.js';
import {
  PERMITS_DEMO_CASES,
  wantsPlaceDemo,
} from './fixtures/permitsDemo.js';
import { globeHref } from './globeLinks.js';
import { createPageHealth, ensureHealthHost } from './health.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
  writePointUrl,
} from './shell.js';
import { esc, kv, listHtml, note } from './ui.js';
import './ops.css';

mountOpsShell({ page: 'place' });

const latInput = document.querySelector('#lat');
const lonInput = document.querySelector('#lon');
const goBtn = document.querySelector('#go');
const statusEl = document.querySelector('#status');
const parcelEl = document.querySelector('#parcel');
const occupancyEl = document.querySelector('#occupancy');
const constructionEl = document.querySelector('#construction');
const floodEl = document.querySelector('#flood-zone');
const hydrantEl = document.querySelector('#nearest-hydrant');
const codeEl = document.querySelector('#code-enforcement');
const mapsEl = document.querySelector('#city-maps');
const linksEl = document.querySelector('#links');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;

const health = createPageHealth(ensureHealthHost(), {
  desk: 'place',
  pollMs: 300_000,
});

let config = null;
let timer = null;

function applySections() {
  for (const section of document.querySelectorAll('[data-place-section]')) {
    const id = section.getAttribute('data-place-section');
    section.classList.toggle('ops-hidden', !placeSectionVisible(config, id));
  }
}

function cityMapsHtml(lat, lon, mun) {
  const munLabel = mun || 'Cape May County NJ';
  return listHtml([
    `<a href="https://maps.nj.gov/viewer/" target="_blank" rel="noopener">NJ Geographic Information Network viewer</a>`,
    `<a href="https://www.capemaycountynj.gov/" target="_blank" rel="noopener">Cape May County</a> — municipal / GIS portals`,
    `<a href="https://www.nj.gov/dca/divisions/codes/" target="_blank" rel="noopener">NJ DCA Codes</a> — statewide construction / enforcement portals`,
    `<a href="https://www.google.com/maps/@${lat},${lon},18z" target="_blank" rel="noopener">Google Maps @ point</a>`,
    `<a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}" target="_blank" rel="noopener">OpenStreetMap @ point</a>`,
    `<a href="/ops/timeline?lat=${lat}&lon=${lon}">Then &amp; Now orthos</a> · ${esc(munLabel)}`,
    `<a href="${globeHref({ lat, lon, layers: ['cape-flood', 'cape-cad'] })}">Globe @ point (flood + CAD)</a>`,
  ]);
}

function renderCases(cases, sourceNote) {
  return (
    listHtml(
      cases.map((c) => {
        const title = c.title || c.type || c.status || c.id || 'Case';
        const meta = [c.status, c.address, c.opened_at || c.date]
          .filter(Boolean)
          .map(esc)
          .join(' · ');
        return `<b>${esc(title)}</b>${meta ? ` — ${meta}` : ''}`;
      }),
    ) +
    `<p class="ops-note">Owner names withheld by policy. ${esc(sourceNote)}</p>`
  );
}

async function loadCodeEnforcement(lat, lon) {
  // Soft Cape endpoints — never invent case data. Prefer Fire Wire, else
  // opt-in anonymized demo fixtures (`?demo=1` / Managers demoFixtures).
  const [permits, code] = await Promise.all([
    capeGet(`permits?lat=${lat}&lon=${lon}`),
    capeGet(`code_enforcement?lat=${lat}&lon=${lon}`),
  ]);
  const cases = []
    .concat(code?.cases || code?.items || [])
    .concat(permits?.permits || permits?.items || [])
    .slice(0, 12);
  if (cases.length) {
    return renderCases(cases, 'Source: Fire Wire when available.');
  }
  const demoOn =
    wantsPlaceDemo() || config?.sources?.place?.demoFixtures === true;
  if (demoOn) {
    return (
      renderCases(
        PERMITS_DEMO_CASES,
        'Demo fixtures only — not live municipal cases. Toggle off via Managers or drop ?demo=1.',
      ) +
      note(
        'No public Cape May permits FeatureServer is wired yet; municipal portals under City maps remain the real index.',
      )
    );
  }
  return (
    note(
      'No Fire Wire code-enforcement / permits feed for this point — use municipal portals under City maps. Case lists never invent data.',
    ) +
    note(
      'For demos: add ?demo=1 or enable Managers → sources.place.demoFixtures (anonymized samples, no owner names).',
    )
  );
}

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    setStatus(statusEl, 'Enter a valid lat / lon', 'error');
    return;
  }
  goBtn.disabled = true;
  setStatus(statusEl, 'Compiling place…');
  try {
    await health.probe(async () => {
      const preferFw = config?.sources?.place?.format === 'firewire';
      const [place, hydrants, flood] = await Promise.all([
        preferFw
          ? capeGet(`place?lat=${lat}&lon=${lon}`).then(
              (fw) => fw || fetchPlace({ lat, lon }),
            )
          : fetchPlace({ lat, lon }),
        fetchHydrants({ lat, lon, radiusM: 500, limit: 5 }),
        fetchFloodZone({ lat, lon }),
      ]);
      writePointUrl(lat, lon);
      const parcel = place.parcel || place.property || {};
      parcelEl.innerHTML = kv([
        ['Address', parcel?.address || place.address],
        ['Municipality', parcel?.municipality || place.municipality],
        ['County', parcel?.county],
        ['Block / Lot', parcel?.blockLot],
        ['PIN', parcel?.pin],
        ['Acres', parcel?.acres],
        ['Assessed (net)', parcel?.assessedNet],
        ['Property class', parcel?.propClass],
      ]);
      occupancyEl.innerHTML = kv([
        ['Occupancy', place.occupancy?.label],
        ['Use', place.occupancy?.use],
        ['Dwellings', place.occupancy?.dwellings],
        ['Commercial units', place.occupancy?.commercialUnits],
      ]);
      constructionEl.innerHTML = kv([
        ['Year built', place.construction?.yearBuilt],
        ['Building', place.construction?.building],
        ['Land', place.construction?.land],
        ['Building class', place.construction?.buildingClass],
        ['Materials note', place.construction?.materialsNote],
      ]);
      floodEl.innerHTML = flood
        ? kv([
            ['Zone', flood.zone],
            ['Subtype', flood.subtype],
            ['SFHA', flood.sfha ? 'yes' : 'no'],
            ['Static BFE', flood.staticBfe],
            ['Source', flood.source],
          ]) +
          `<p class="ops-note"><a href="/ops/flood?lat=${lat}&lon=${lon}">Open Flood desk</a> · <a href="${globeHref({ lat, lon, layers: ['cape-flood'] })}">Globe flood layer</a></p>`
        : '<p class="ops-note">Flood zone unavailable</p>';
      const nearest = hydrants?.nearest || hydrants?.hydrants?.[0];
      hydrantEl.innerHTML = nearest
        ? kv([
            [
              'Distance',
              nearest.distanceM != null ? `${nearest.distanceM} m` : null,
            ],
            ['Municipality', nearest.municipality],
            ['Color', nearest.color],
            ['Type', nearest.type],
            ['Number', nearest.number],
            [
              'Coordinates',
              `${nearest.lat?.toFixed?.(5)}, ${nearest.lon?.toFixed?.(5)}`,
            ],
          ]) +
          `<p class="ops-note"><a href="/ops/hydrants?lat=${lat}&lon=${lon}">Open hydrants catalog</a></p>`
        : '<p class="ops-note">No hydrant within search radius.</p>';

      if (placeSectionVisible(config, 'codeEnforcement')) {
        codeEl.innerHTML = await loadCodeEnforcement(lat, lon);
      }
      if (placeSectionVisible(config, 'cityMaps')) {
        mapsEl.innerHTML = cityMapsHtml(
          lat,
          lon,
          parcel?.municipality || place.municipality,
        );
      }

      linksEl.innerHTML = `
      <ul class="ops-list">
        <li><a href="/ops/timeline?lat=${lat}&lon=${lon}">Then &amp; Now at this point</a></li>
        <li><a href="/ops/incidents">CAD / Incidents</a></li>
        <li><a href="${globeHref({ lat, lon, layers: ['cape-cad', 'cape-cameras'] })}">Open on globe (CAD + cameras)</a></li>
      </ul>`;
      setStatus(
        statusEl,
        place.source
          ? `Ready · ${place.source}${place.stale ? ' (stale cache)' : ''}`
          : 'Ready',
        'ok',
      );
      return {
        source: place.source || (preferFw ? 'firewire|native' : 'ops-place'),
        stale: Boolean(place.stale),
      };
    });
  } catch (error) {
    setStatus(statusEl, error.message || 'Place lookup failed', 'error');
  } finally {
    goBtn.disabled = false;
  }
}

function schedule(ms) {
  if (timer) clearInterval(timer);
  health.setPollMs(ms);
  timer = setInterval(() => void load(), ms);
}

goBtn.addEventListener('click', () => void load());
latInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());
lonInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());

void (async () => {
  config = await fetchOpsConfig();
  if (!applyDeskViewability(config, 'place', statusEl)) return;
  applySections();
  schedule(intervalFor(config, 'place', 300_000));
  await load();
})();
