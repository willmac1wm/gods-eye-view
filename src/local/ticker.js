/**
 * County ticker: one line of the numbers people check first — the tide at
 * Cape May Harbor, the airport's weather, the sea off Cape May, power
 * outages, NWS alerts and the price of gas. The first five read the same
 * /api/local summaries the map layers use; GAS reads /api/fuel (EIA weekly
 * averages). A click on an item turns its layer on, and GAS also opens a
 * card with links to local station prices. When something happened in the
 * last hour, a LATEST item from /api/local/events leads the strip; a click
 * on it opens that event instead of toggling a layer.
 *
 * English-only county content, like the Local panel.
 */
import { fetchLocal } from './api.js';
import { createEiaFuelSource } from '../layers/fuel/source.js';
import { fuelDetailsRecord, fuelTickerItem } from './fuelCard.js';
import { latestTickerItem, loadEvents } from './eventFeed.js';

const REFRESH_MS = 120_000;
/** EIA publishes weekly and the server caches 6 h: once an hour is plenty. */
const FUEL_REFRESH_MS = 60 * 60 * 1000;
/** With no price yet (no key, fetch failed), try again after this long. */
const FUEL_RETRY_MS = 10 * 60 * 1000;
/** Older than this, an observation is shown as stale. */
const STALE_MS = 3 * 60 * 60 * 1000;
/**
 * LATEST only shows an event from the last hour, and an event is seen after
 * it happens, so after the first read (the whole list) the strip asks only
 * for what was seen since a little over an hour before the last answer
 * (?since=). The time is the server's own (generatedAt), never this
 * device's clock, which may be off by hours.
 */
const EVENTS_LOOKBACK_MS = 65 * 60 * 1000;
/** A server without the events route (404) is not asked again for this long. */
const EVENTS_MISSING_PAUSE_MS = 30 * 60 * 1000;

/** The /api/local feeds the ticker reads, in display order. */
export const TICKER_SOURCES = Object.freeze({
  tide: { name: 'tide-gauges', id: 'nwps:CAPN4', layerId: 'tide-gauges' },
  airport: {
    name: 'airport-weather',
    id: 'metar:KWWD',
    layerId: 'airport-weather',
  },
  sea: { name: 'marine-buoys', id: 'ndbc:44009', layerId: 'marine-buoys' },
  outages: { name: 'power-outages', layerId: 'power-outages' },
  alerts: { name: 'nws-alerts', layerId: 'nws-alerts' },
});

/** The GAS item: read from /api/fuel, not /api/local. */
export const FUEL_TICKER = Object.freeze({ layerId: 'fuel-prices' });

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

/** A real number, or null: a missing reading (null, '', undefined) is not 0. */
const finite = (value) =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;

function compass(deg) {
  const d = finite(deg);
  return d === null
    ? ''
    : COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];
}

/** "calm", "NE 12 kt", "NE 12 G20 kt". */
export function windText(dirDeg, speedKt, gustKt) {
  const speed = finite(speedKt);
  if (speed === null) return '';
  if (Math.round(speed) === 0) return 'calm';
  const gust = finite(gustKt);
  const gusting = gust !== null && Math.round(gust) > Math.round(speed);
  return `${compass(dirDeg)} ${Math.round(speed)}${gusting ? ` G${Math.round(gust)}` : ''} kt`.trim();
}

function easternTime(iso, now) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay =
    Math.abs(at.getTime() - now) < 20 * 60 * 60 * 1000 &&
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      day: 'numeric',
    }).format(at) ===
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        day: 'numeric',
      }).format(new Date(now));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

const isStale = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) && now - t > STALE_MS;
};

const FLOOD_TONE = {
  no_flooding: 'ok',
  action: 'watch',
  minor: 'watch',
  moderate: 'warn',
  major: 'danger',
};
const FLOOD_WORDS = {
  action: 'action stage',
  minor: 'minor flooding',
  moderate: 'moderate flooding',
  major: 'major flooding',
};

const findFeature = (envelope, id) =>
  (Array.isArray(envelope?.features) ? envelope.features : []).find(
    (feature) => feature?.id === id,
  ) || null;

const missing = (key, label) => ({
  key,
  layerId: (TICKER_SOURCES[key] || FUEL_TICKER).layerId,
  label,
  value: '—',
  detail: '',
  tone: 'muted',
  // i18n-ignore: the county ticker is English-only county content.
  title: `${label}: no reading`,
});

/**
 * The ticker's items from the five /api/local envelopes and the EIA fuel
 * snapshot. Pure: every value the strip shows comes from here.
 * @param {{tide?: object, airport?: object, sea?: object, outages?: object, alerts?: object, fuel?: object}} envelopes
 * @param {number} [now]
 */
export function tickerItems(envelopes = {}, now = Date.now()) {
  const items = [];

  const gauge = findFeature(envelopes.tide, TICKER_SOURCES.tide.id);
  const level = finite(gauge?.observed?.value);
  if (gauge && level !== null) {
    const category = gauge.observed?.category || 'no_flooding';
    const peak = finite(gauge.forecast?.value);
    const stale = isStale(gauge.observed?.time, now);
    items.push({
      key: 'tide',
      layerId: TICKER_SOURCES.tide.layerId,
      // i18n-ignore: the county ticker is English-only county content.
      label: 'TIDE',
      value: `${level.toFixed(1)} ft`,
      detail:
        FLOOD_WORDS[category] ||
        (peak !== null
          ? `peak ${peak.toFixed(1)} ft ${easternTime(gauge.forecast.time, now)}`
          : ''),
      tone: stale ? 'muted' : FLOOD_TONE[category] || 'ok',
      // i18n-ignore: the county ticker is English-only county content.
      title: `Cape May Harbor water level ${level.toFixed(2)} ft (MLLW)${stale ? ', stale' : ''}`,
    });
  } else items.push(missing('tide', 'TIDE'));

  const metar = findFeature(envelopes.airport, TICKER_SOURCES.airport.id);
  if (metar) {
    const temp = finite(metar.tempF);
    const parts = [
      temp === null ? '' : `${Math.round(temp)}°F`,
      windText(metar.windDirDeg, metar.windKt, metar.gustKt),
    ].filter(Boolean);
    const category = String(metar.flightCategory || '').toUpperCase();
    items.push({
      key: 'airport',
      layerId: TICKER_SOURCES.airport.layerId,
      // i18n-ignore: the county ticker is English-only county content.
      label: 'KWWD',
      value: category || 'METAR',
      detail: parts.join(' · '),
      tone: isStale(metar.observedAt, now)
        ? 'muted'
        : category === 'IFR' || category === 'LIFR'
          ? 'warn'
          : category === 'MVFR'
            ? 'watch'
            : 'ok',
      // i18n-ignore: the county ticker is English-only county content.
      title: metar.rawMetar || 'Cape May County Airport weather',
    });
  } else items.push(missing('airport', 'KWWD'));

  const buoy = findFeature(envelopes.sea, TICKER_SOURCES.sea.id);
  const reading = buoy?.reading;
  if (reading) {
    const wave = finite(reading.waveHeightFt);
    const water = finite(reading.waterTempF);
    const detail = [
      wave === null ? '' : `waves ${wave.toFixed(1)} ft`,
      water === null ? '' : `water ${Math.round(water)}°F`,
    ]
      .filter(Boolean)
      .join(' · ');
    items.push({
      key: 'sea',
      layerId: TICKER_SOURCES.sea.layerId,
      // i18n-ignore: the county ticker is English-only county content.
      label: 'SEA',
      value:
        windText(reading.windDirDeg, reading.windSpeedKt, reading.gustKt) ||
        '—',
      detail,
      tone: isStale(reading.observedAt, now) ? 'muted' : 'ok',
      // i18n-ignore: the county ticker is English-only county content.
      title: buoy.title || 'Buoy 44009, 26 NM SE of Cape May',
    });
  } else items.push(missing('sea', 'SEA'));

  const counties = envelopes.outages?.summary?.counties;
  const cape = Array.isArray(counties)
    ? counties.find((row) => row?.county === 'Cape May')
    : null;
  if (cape) {
    const out = finite(cape.out) ?? 0;
    items.push({
      key: 'outages',
      layerId: TICKER_SOURCES.outages.layerId,
      // i18n-ignore: the county ticker is English-only county content.
      label: 'POWER',
      value: out === 0 ? 'no outages' : `${out.toLocaleString('en-US')} out`,
      detail: '',
      tone: out === 0 ? 'ok' : out >= 1000 ? 'warn' : 'watch',
      // i18n-ignore: the county ticker is English-only county content.
      title: 'Atlantic City Electric customers out in Cape May County',
    });
  } else items.push(missing('outages', 'POWER'));

  const alerts = envelopes.alerts?.summary;
  if (alerts && Number.isFinite(Number(alerts.count))) {
    const count = Number(alerts.count);
    const top = alerts.top?.title || alerts.top?.event || '';
    items.push({
      key: 'alerts',
      layerId: TICKER_SOURCES.alerts.layerId,
      // i18n-ignore: the county ticker is English-only county content.
      label: 'NWS',
      value:
        count === 0
          ? 'no alerts'
          : top || `${count} alert${count === 1 ? '' : 's'}`,
      detail: count > 1 && top ? `+${count - 1} more` : '',
      tone:
        count === 0
          ? 'ok'
          : Number(alerts.warnings) > 0
            ? 'danger'
            : Number(alerts.watches) > 0
              ? 'warn'
              : 'watch',
      // i18n-ignore: the county ticker is English-only county content.
      title: 'National Weather Service alerts for Cape May County',
    });
  } else items.push(missing('alerts', 'NWS'));

  items.push(fuelTickerItem(envelopes.fuel, now) || missing('fuel', 'GAS'));

  return items;
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function render(strip, items) {
  strip.innerHTML = items
    .map(
      (item) =>
        `<button type="button" class="gev-ticker-item tone-${escapeHtml(item.tone)}" data-key="${escapeHtml(item.key)}"${item.layerId ? ` data-layer-id="${escapeHtml(item.layerId)}"` : ''}${item.eventId ? ` data-event-id="${escapeHtml(item.eventId)}"` : ''} title="${escapeHtml(item.title)}"><span class="gev-ticker-label">${escapeHtml(item.label)}</span> <span class="gev-ticker-value">${escapeHtml(item.value)}</span>${item.detail ? ` <span class="gev-ticker-detail">${escapeHtml(item.detail)}</span>` : ''}</button>`,
    )
    .join('');
}

/** A server time in epoch ms, or null for anything a Date cannot hold. */
const serverTime = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= 8.64e15
    ? value
    : null;

/**
 * Mount the ticker and keep it fresh. Returns its disposer.
 * @param {{dataManager?: object, fetchSource?: Function, fetchFuel?: Function, fetchEvents?: Function, openDetails?: Function, openEvent?: Function, doc?: Document, refreshMs?: number, fuelRefreshMs?: number, fuelRetryMs?: number, now?: () => number}} options
 *   fetchFuel({signal}) resolves an EIA fuel snapshot; openDetails(record)
 *   shows a details-window record (the GAS card). fetchEvents({signal,
 *   since}) resolves an /api/local/events body or null (default: loadEvents;
 *   since is undefined on the first read, then the last answer's
 *   generatedAt less 65 minutes); a rejection carrying status 404 pauses it
 *   like the default read's 404. openEvent(eventId) opens one event (the
 *   LATEST item's click).
 */
export function installCountyTicker({
  dataManager,
  fetchSource = fetchLocal,
  fetchFuel,
  fetchEvents,
  openDetails,
  openEvent,
  doc = globalThis.document,
  refreshMs = REFRESH_MS,
  fuelRefreshMs = FUEL_REFRESH_MS,
  fuelRetryMs = FUEL_RETRY_MS,
  now = () => Date.now(),
} = {}) {
  if (!doc?.body) return () => {};
  const loadFuel =
    fetchFuel ??
    (() => {
      const source = createEiaFuelSource();
      return (options) => source.getSnapshot(options);
    })();
  // Either reader resolves { data, status }: data is an events body or null,
  // status the HTTP status of a failed default read (404: no events route).
  const readEvents = fetchEvents
    ? (options) =>
        Promise.resolve()
          .then(() => fetchEvents(options))
          .then(
            (value) => ({
              data: value && typeof value === 'object' ? value : null,
            }),
            (failure) => ({ data: null, status: failure?.status }),
          )
    : (options) =>
        loadEvents(options).then(
          (result) => ({
            data: result?.ok ? result.data : null,
            status: result?.status,
          }),
          () => ({ data: null }),
        );
  const strip = doc.createElement('nav');
  strip.id = 'gev-county-ticker';
  // i18n-ignore: the county ticker is English-only county content.
  strip.setAttribute('aria-label', 'Cape May County conditions');
  render(strip, tickerItems({}, now()));
  doc.body.appendChild(strip);

  // The last good fuel snapshot is kept: a failed hourly check leaves the
  // weekly price up (shown muted once it is old), never a blank.
  let fuel = null;
  let fuelTriedAt = -Infinity;
  // Likewise the last good events answer: LATEST only ever shows an event
  // from the last hour, so a kept answer ages out on its own.
  let events = null;
  // The server's clock at the last good answer (generatedAt), and how far
  // it is from this device's clock: ?since= and LATEST's one-hour window
  // follow the server, so a phone set hours off still sees LATEST.
  let serverAt = null;
  let skewMs = 0;
  // When a 404 said this server has no events route (null: not paused).
  let eventsMissingAt = null;
  let items = null;
  const draw = () => {
    let latest = null;
    try {
      latest = latestTickerItem(events, now() + skewMs);
    } catch {
      /* LATEST is extra; the other items still show */
    }
    const rest = items ?? tickerItems({}, now());
    render(strip, latest ? [latest, ...rest] : rest);
  };
  const eventsPaused = () => {
    if (eventsMissingAt === null) return false;
    const elapsed = now() - eventsMissingAt;
    // A clock set back is no reason to wait longer than the pause.
    if (elapsed >= 0 && elapsed < EVENTS_MISSING_PAUSE_MS) return true;
    eventsMissingAt = null;
    return false;
  };
  /** Turn a layer on (never off): the ticker only ever shows things. */
  const switchOn = (layerId) => {
    if (!layerId || !dataManager?.setEnabled) return;
    try {
      if (!dataManager.isEnabled?.(layerId))
        dataManager.setEnabled(layerId, true, { origin: 'user' });
    } catch {
      /* a layer this build lacks */
    }
  };

  strip.addEventListener('click', (event) => {
    const item = event.target?.closest?.('.gev-ticker-item');
    if (!item) return;
    const { key, layerId, eventId } = item.dataset;
    // LATEST: the panel opens the event; without that, its own layer (if
    // it has one) is switched on; an event with neither does nothing.
    if (key === 'events') {
      if (eventId && typeof openEvent === 'function') {
        try {
          openEvent(eventId);
        } catch {
          /* the panel decides what an event opens; nothing to undo here */
        }
        return;
      }
      switchOn(layerId);
      return;
    }
    if (!layerId) return;
    if (key === 'fuel' && typeof openDetails === 'function') {
      try {
        openDetails(fuelDetailsRecord(fuel, now()));
      } catch {
        /* the card is extra; the layer toggle below still runs */
      }
    }
    switchOn(layerId);
  });

  let controller = null;
  let disposed = false;
  const refresh = async () => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const keys = Object.keys(TICKER_SOURCES);
    // One events read per refresh, alongside the other sources but never
    // waited on by them: a slow or failed events read cannot hold up or
    // blank the rest of the strip. None while a 404 pause runs.
    const eventsRead = eventsPaused()
      ? null
      : readEvents({
          signal,
          since:
            serverAt === null || serverAt - EVENTS_LOOKBACK_MS <= 0
              ? undefined
              : serverAt - EVENTS_LOOKBACK_MS,
        });
    const fuelDue = now() - fuelTriedAt >= (fuel ? fuelRefreshMs : fuelRetryMs);
    const [results, fuelResult] = await Promise.all([
      Promise.allSettled(
        keys.map((key) => fetchSource(TICKER_SOURCES[key].name, { signal })),
      ),
      fuelDue
        ? Promise.resolve()
            .then(() => loadFuel({ signal }))
            .then(
              (value) => ({ value }),
              () => ({ value: null }),
            )
        : null,
    ]);
    if (disposed || signal.aborted) return;
    if (fuelResult) {
      fuelTriedAt = now();
      if (fuelResult.value) fuel = fuelResult.value;
    }
    const envelopes = { fuel };
    keys.forEach((key, index) => {
      if (results[index].status === 'fulfilled')
        envelopes[key] = results[index].value;
    });
    items = tickerItems(envelopes, now());
    draw();
    if (!eventsRead) return;
    const answer = await eventsRead;
    if (disposed || signal.aborted) return;
    if (answer.status === 404) {
      // This server has no events route (yet): stop asking for a while.
      eventsMissingAt = now();
      strip.dataset.events = 'missing';
    } else if (answer.data) {
      events = answer.data;
      const generated = serverTime(answer.data.generatedAt);
      if (generated !== null) {
        serverAt = generated;
        skewMs = generated - now();
      }
      strip.dataset.events = 'ok';
    } else {
      strip.dataset.events = 'failed';
    }
    draw();
  };
  void refresh();
  const timer = setInterval(() => void refresh(), refreshMs);

  return () => {
    disposed = true;
    clearInterval(timer);
    controller?.abort();
    strip.remove();
  };
}
