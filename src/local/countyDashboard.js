/**
 * County dashboard: the county-wide numbers that are not map layers — gas,
 * space weather, drought, background radiation, FAA airport status,
 * internet outages, disease outbreaks and disaster history — as readouts in
 * the Local panel's County tab. Each reads the same /api endpoint its layer
 * uses, and each card keeps a "Show on map" switch for its layer.
 *
 * A reading that fails or has no value says so ("No reading"); a number is
 * never guessed. Every card names its source and when the server last
 * fetched it, in US Eastern time. English-only county content, like the
 * Local panel.
 */
import {
  heatingOilStatus,
  normalizeEiaSeriesResponse,
  latestPerSeries,
} from '../layers/fuel/records.js';
import { easternTime, escapeHtml, relativeTime } from './format.js';

const DAY_MS = 86_400_000;
/** EIA posts gas and diesel every Monday: older than two weeks is not current. */
const FUEL_CURRENT_DAYS = 14;
/** Cape May County's FIPS code: CDC ArboNET county rows carry only this. */
const CAPE_MAY_FIPS = '34009';

const money = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : null);

function weekText(period) {
  const at = new Date(`${period}T12:00:00Z`);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

export function readFuel(d, now = Date.now()) {
  const series = {
    ...normalizeEiaSeriesResponse(d?.gnd),
    ...normalizeEiaSeriesResponse(d?.wfr),
  };
  const latest = latestPerSeries(series);
  const gas = latest.EMM_EPMR_PTE_R1Y_DPG;
  if (!gas || !Number.isFinite(gas.value)) return null;
  const diesel = money(latest.EMD_EPD2D_PTE_R1Y_DPG?.value);
  const oil = latest.W_EPD2F_PRS_SNJ_DPG;
  const oilPrice = money(oil?.value);
  // Heating oil is collected October to March only: out of season the last
  // price is shown with its week, never as current.
  const oilCurrent =
    oil && heatingOilStatus(oil.period, now).state === 'current';
  const ageDays = (now - Date.parse(`${gas.period}T12:00:00Z`)) / DAY_MS;
  const current = Number.isFinite(ageDays) && ageDays <= FUEL_CURRENT_DAYS;
  return {
    value: money(gas.value),
    detail: [
      'regular, Mid-Atlantic weekly average',
      diesel ? `diesel ${diesel}` : '',
      oilPrice
        ? `NJ heating oil ${oilPrice}${oilCurrent ? '' : ` (week of ${weekText(oil.period)}, not current)`}`
        : '',
      `week of ${weekText(gas.period)}${current ? '' : ', not current'}`,
    ]
      .filter(Boolean)
      .join(' · '),
    tone: current ? 'ok' : 'muted',
  };
}

const G_SCALE = [
  [9, 'G5 extreme storm', 'danger'],
  [8, 'G4 severe storm', 'danger'],
  [7, 'G3 strong storm', 'warn'],
  [6, 'G2 moderate storm', 'warn'],
  [5, 'G1 minor storm', 'watch'],
  [4, 'active', 'watch'],
  [0, 'quiet', 'ok'],
];

export function readSpaceWeather(d) {
  const minute = Array.isArray(d?.kpMinute) ? d.kpMinute.at(-1) : null;
  const kp = Number(minute?.estimated_kp ?? minute?.kp_index);
  if (!Number.isFinite(kp) || kp < 0) return null;
  const [, words, tone] = G_SCALE.find(([min]) => kp >= min);
  const ahead = (Array.isArray(d?.kpForecast) ? d.kpForecast : [])
    .filter((r) => r?.observed === 'predicted' && Number.isFinite(Number(r.kp)))
    .map((r) => Number(r.kp));
  const peak = ahead.length ? Math.max(...ahead) : null;
  return {
    value: `Kp ${kp.toFixed(1)}`,
    detail: `${words}${peak !== null ? ` · forecast peak Kp ${peak.toFixed(1)}` : ''} · Kp 5+ can degrade GPS and HF radio`,
    tone,
  };
}

const DROUGHT = [
  'D0 abnormally dry',
  'D1 moderate drought',
  'D2 severe drought',
  'D3 extreme drought',
  'D4 exceptional drought',
];

export function readDrought(d) {
  if (!d || typeof d !== 'object' || !('category' in d)) return null;
  const c = d.category;
  const at = d.releasedAt ? new Date(d.releasedAt) : null;
  const released =
    at && !Number.isNaN(at.getTime())
      ? at.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'America/New_York',
        })
      : '';
  const known = Number.isInteger(c) && c >= 0 && c <= 4;
  return {
    value: known ? DROUGHT[c].split(' ')[0] : 'None',
    detail: `${known ? DROUGHT[c].slice(3) : 'no drought in the county'}${released ? ` · map released ${released}` : ''}`,
    tone: !known || c === 0 ? 'ok' : c === 1 ? 'watch' : 'warn',
  };
}

export function readRadiation(d) {
  const monitors = (Array.isArray(d?.monitors) ? d.monitors : []).filter(
    (m) =>
      m?.doseRateNSvH !== null &&
      m?.doseRateNSvH !== undefined &&
      m?.doseRateNSvH !== '' &&
      Number.isFinite(Number(m.doseRateNSvH)),
  );
  if (!monitors.length) return null;
  const near = [...monitors].sort(
    (a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9),
  )[0];
  return {
    value: `${Number(near.doseRateNSvH)} nSv/h`,
    detail: `${near.name}${near.state ? `, ${near.state}` : ''} monitor${Number.isFinite(near.distanceKm) ? ` (${Math.round(near.distanceKm * 0.621371)} mi away)` : ''} · regional background, not a county reading`,
    tone: 'ok',
  };
}

const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The FAA NAS status feed names airports by their 3-letter FAA id; in the
 * contiguous U.S. the ICAO id is that id with a K in front (ACY → KACY).
 */
const icao = (code) =>
  /^[A-Z]{3}$/.test(String(code || '')) ? `K${code}` : String(code || '?');

const LOCAL_AIRPORTS = 'KACY, KPHL, KEWR';
const lower = (value) => String(value).toLowerCase();

function faaEvent(e) {
  const where = icao(e?.airport);
  const why = e?.reason ? ` (${lower(e.reason)})` : '';
  switch (e?.category) {
    case 'ground-stop':
      return `${where} ground stop${e.endTime ? ` until ${e.endTime}` : ''}${why}`;
    case 'ground-delay':
      return `${where} ground delay program${e.avg ? `, avg delay ${lower(e.avg)}` : ''}${why}`;
    case 'closure':
      return `${where} closed${why}`;
    case 'arrival-departure': {
      // For this category the feed's Min and Max ride in avg and max.
      const kind = /^(arrival|departure)$/i.test(e.delayType || '')
        ? `${lower(e.delayType)} delays`
        : 'arrival/departure delays';
      const span =
        e.avg && e.max
          ? ` ${lower(e.avg)} to ${lower(e.max)}`
          : e.avg
            ? ` ${lower(e.avg)}`
            : '';
      return `${where} ${kind}${span}${why}`;
    }
    default:
      return `${where} ${e?.category || 'event'}${why}`;
  }
}

export function readFaa(d) {
  const n = d?.nationwide;
  if (!n || typeof n !== 'object') return null;
  const local = Array.isArray(d.local) ? d.local : [];
  return {
    value: local.length
      ? local.slice(0, 2).map(faaEvent).join('; ')
      : `${LOCAL_AIRPORTS}: no delays`,
    detail: `nationwide: ${plural(Number(n.groundStop) || 0, 'ground stop')} · ${plural(Number(n.groundDelay) || 0, 'ground delay program')} · ${plural(Number(n.closure) || 0, 'closure')} · ${plural(Number(n.arrivalDepartureDelay) || 0, 'airport')} with arrival/departure delays`,
    tone: local.some(
      (e) => e?.category === 'ground-stop' || e?.category === 'closure',
    )
      ? 'warn'
      : local.length
        ? 'watch'
        : 'ok',
  };
}

export function readInternet(d) {
  if (
    !d ||
    typeof d !== 'object' ||
    !('njSummary' in d) ||
    d.sources?.njSummary?.ok === false
  )
    return null;
  const nj = count(d.njSummary);
  const us = d.sources?.usSummary?.ok === false ? null : count(d.usSummary);
  const world = count(d.alerts);
  return {
    value: nj ? `${plural(nj, 'NJ outage event')}` : 'No NJ outages',
    detail: [
      us === null ? '' : `U.S.: ${us ? plural(us, 'outage event') : 'none'}`,
      `${plural(world, 'alert')} worldwide`,
    ]
      .filter(Boolean)
      .join(' · '),
    tone: nj ? 'watch' : 'ok',
  };
}

export function readOutbreaks(d) {
  if (!d || typeof d !== 'object') return null;
  // Each half fails on its own (ok:false); with neither there is no reading.
  const cdcOk = d.arbonet?.ok === true;
  const whoOk = d.don?.ok === true;
  if (!cdcOk && !whoOk) return null;
  const who = whoOk && Array.isArray(d.don.items) ? d.don.items[0] : null;
  // CDC county rows carry the FIPS code, not a name.
  const counties = Array.isArray(d.arbonet?.njCounties)
    ? d.arbonet.njCounties
    : [];
  const cape = counties.find(
    (c) =>
      String(c?.fips ?? '') === CAPE_MAY_FIPS ||
      /cape may/i.test(c?.county || c?.name || ''),
  );
  const raw = cape?.humanCases ?? cape?.cases;
  const capeCases = raw === null || raw === undefined ? NaN : Number(raw);
  const asOf = cdcOk && d.arbonet.asOf ? ` · CDC as of ${d.arbonet.asOf}` : '';
  return {
    // CDC ArboNET counts are preliminary; ok:false means the read failed,
    // not that the CDC posted nothing.
    value: cdcOk
      ? Number.isFinite(capeCases)
        ? `${capeCases} human West Nile case${capeCases === 1 ? '' : 's'} in the county`
        : 'No county West Nile activity listed'
      : 'CDC county data unavailable',
    detail: `${
      whoOk
        ? who?.title
          ? `latest WHO notice: ${who.title}`
          : 'no WHO notices'
        : 'WHO notices unavailable'
    }${asOf}`,
    tone: !cdcOk
      ? 'muted'
      : Number.isFinite(capeCases) && capeCases > 0
        ? 'watch'
        : 'ok',
  };
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to']);

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w+/g, (word, at) =>
      at > 0 && SMALL_WORDS.has(word)
        ? word
        : word[0].toUpperCase() + word.slice(1),
    );
}

export function readDisasters(d) {
  const rows =
    d?.fema && typeof d.fema === 'object'
      ? d.fema.DisasterDeclarationsSummaries ||
        Object.values(d.fema).find(Array.isArray) ||
        []
      : [];
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = [...rows].sort((a, b) =>
    String(a?.declarationDate).localeCompare(String(b?.declarationDate)),
  );
  const latest = sorted.at(-1);
  const first = String(sorted[0]?.declarationDate || '').slice(0, 4);
  const year = String(latest?.declarationDate || '').slice(0, 4);
  const title = titleCase(latest?.declarationTitle || latest?.incidentType);
  return {
    value: `${plural(rows.length, 'federal declaration')}${/^\d{4}$/.test(first) ? ` since ${first}` : ''}`,
    detail: `latest: ${title || 'not named'}${/^\d{4}$/.test(year) ? ` (${year})` : ''}`,
    tone: 'ok',
  };
}

/**
 * What the dashboard shows, in order. `id` is the layer its card can show on
 * the map; `source` is named on the card.
 */
export const DASHBOARD_ITEMS = Object.freeze([
  {
    id: 'fuel-prices',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Gas prices',
    source: 'U.S. EIA',
    endpoint: '/api/fuel',
    read: readFuel,
  },
  {
    id: 'faa-status',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Airports (FAA)',
    source: 'FAA NAS Status',
    endpoint: '/api/faa-status',
    read: readFaa,
  },
  {
    id: 'space-weather',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Space weather',
    source: 'NOAA SWPC',
    endpoint: '/api/space-weather',
    read: readSpaceWeather,
  },
  {
    id: 'drought',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Drought',
    source: 'U.S. Drought Monitor',
    endpoint: '/api/drought',
    read: readDrought,
  },
  {
    id: 'radiation',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Background radiation',
    source: 'EPA RadNet',
    endpoint: '/api/radiation',
    read: readRadiation,
  },
  {
    id: 'internet-outages',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Internet outages',
    source: 'IODA (Georgia Tech)',
    endpoint: '/api/internet-outages',
    read: readInternet,
  },
  {
    id: 'outbreaks',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Disease outbreaks',
    source: 'CDC ArboNET and WHO',
    endpoint: '/api/outbreaks',
    read: readOutbreaks,
  },
  {
    id: 'disaster-history',
    // i18n-ignore: the Local panel is English-only county content.
    title: 'Disaster history',
    source: 'OpenFEMA',
    endpoint: '/api/disaster-history',
    read: readDisasters,
  },
]);

/** The latest time a JavaScript Date can hold (ms since 1970). */
const MAX_DATE_MS = 8.64e15;

/**
 * Epoch ms from a number or an ISO string; null otherwise, and null for a
 * value no Date can hold (formatting one would throw and blank the tab).
 */
function toMs(value) {
  const t = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(t) && t > 0 && t <= MAX_DATE_MS ? t : null;
}

/**
 * Read every dashboard item; a failure becomes "No reading", never a guess.
 * Each result keeps when the server fetched it and whether the server says
 * the answer is stale (served from its cache after the source failed).
 * Never throws.
 */
export async function loadDashboard({
  fetchImpl = (...a) => globalThis.fetch(...a),
  signal,
} = {}) {
  return Promise.all(
    DASHBOARD_ITEMS.map(async (item) => {
      try {
        const response = await fetchImpl(item.endpoint, {
          signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        if (!response?.ok) throw new Error(`HTTP ${response?.status}`);
        const body = await response.json();
        const reading = item.read(body);
        return {
          ...item,
          reading: reading?.value ? reading : null,
          fetchedAt: toMs(body?.fetchedAt),
          stale: body?.stale === true,
        };
      } catch {
        return { ...item, reading: null, fetchedAt: null, stale: false };
      }
    }),
  );
}

/** "Source: NOAA SWPC · fetched 9:35 PM EST (3 min ago)". */
function metaText(item, now) {
  const parts = [`Source: ${item.source || 'not stated'}`];
  if (item.reading && item.fetchedAt) {
    const at = easternTime(item.fetchedAt, { date: false });
    const ago = relativeTime(item.fetchedAt, now);
    if (at) parts.push(`fetched ${at}${ago ? ` (${ago})` : ''}`);
  }
  if (item.reading && item.stale) parts.push('not current');
  return parts.join(' · ');
}

const TONES = new Set(['ok', 'watch', 'warn', 'danger', 'muted']);

/**
 * The dashboard's cards. `toggle(id, name)` is the Local panel's
 * "Show on map" switch markup.
 */
export function dashboardHtml(
  items,
  { toggle = () => '', now = Date.now() } = {},
) {
  const list = Array.isArray(items) ? items : [];
  return `<div class="gev-dash">${list
    .map((item) => {
      const tone =
        item.reading && !item.stale && TONES.has(item.reading.tone)
          ? item.reading.tone
          : 'muted';
      return `<div class="gev-dash-card tone-${tone}">
        <span class="gev-local-kicker">${escapeHtml(item.title)}</span>
        <strong class="gev-dash-value">${escapeHtml(item.reading?.value || 'No reading')}</strong>
        <span class="gev-dash-detail">${escapeHtml(item.reading?.detail || 'The source did not answer. Try again in a few minutes.')}</span>
        <small class="gev-dash-meta">${escapeHtml(metaText(item, now))}</small>
        ${toggle(item.id, item.title)}
      </div>`;
    })
    .join('')}</div>`;
}
