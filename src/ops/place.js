import { fetchFloodZone, fetchHydrants, fetchPlace } from './api.js';
import {
  OPS_HOME,
  mountOpsShell,
  parsePointParams,
  setStatus,
  writePointUrl,
} from './shell.js';
import { kv } from './ui.js';
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
const linksEl = document.querySelector('#links');

const point = parsePointParams();
latInput.value = point.lat ?? OPS_HOME.lat;
lonInput.value = point.lon ?? OPS_HOME.lon;

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
    const [place, hydrants, flood] = await Promise.all([
      fetchPlace({ lat, lon }),
      fetchHydrants({ lat, lon, radiusM: 500, limit: 5 }),
      fetchFloodZone({ lat, lon }),
    ]);
    writePointUrl(lat, lon);
    const parcel = place.parcel;
    parcelEl.innerHTML = kv([
      ['Address', parcel?.address],
      ['Municipality', parcel?.municipality],
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
        `<p class="ops-note"><a href="/ops/flood?lat=${lat}&lon=${lon}">Open Flood desk</a></p>`
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
    linksEl.innerHTML = `
      <ul class="ops-list">
        <li><a href="/ops/timeline?lat=${lat}&lon=${lon}">Then &amp; Now at this point</a></li>
        <li><a href="/ops/incidents">CAD / Incidents</a></li>
        <li><a href="/?lat=${lat}&lon=${lon}">Open on globe</a></li>
      </ul>`;
    setStatus(
      statusEl,
      place.source
        ? `Ready · ${place.source}${place.stale ? ' (stale cache)' : ''}`
        : 'Ready',
      'ok',
    );
  } catch (error) {
    setStatus(statusEl, error.message || 'Place lookup failed', 'error');
  } finally {
    goBtn.disabled = false;
  }
}

goBtn.addEventListener('click', () => void load());
latInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());
lonInput.addEventListener('keydown', (e) => e.key === 'Enter' && load());
void load();
