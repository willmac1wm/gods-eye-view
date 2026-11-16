/**
 * FAA National Airspace System (NAS) status feed: parse the public XML
 * (https://nasstatus.faa.gov/api/airport-status-information) into local
 * airport events + nationwide counts. Pure: no fetch, no DOM, no Cesium.
 *
 * The feed is one national document; there is no per-airport query. The
 * layer only pins ACY / PHL / EWR, but a national ground stop shows up as
 * many airports at once, so nationwide per-category counts ride along.
 *
 * Feed shape (verified live 2026-11-16): <AIRPORT_STATUS_INFORMATION>
 * with <Update_Time> and one <Delay_type> block per category. Categories
 * repeat — two separate blocks are both named "Airport Closures" — so
 * counts accumulate, never overwrite. Entry tags differ per category:
 * <Program> (ground stop, End_Time), <Ground_Delay> (Avg/Max),
 * <Airport> (closure, Start/Reopen), <Delay> (arrival/departure, nested
 * <Arrival_Departure Type="..."> with Min/Max/Trend).
 *
 * Start/Reopen carry no year ("Nov 16 at 07:30 UTC.") — inferred from
 * Update_Time; a Jan–Mar date against an Oct–Dec update rolls to the
 * next year (and vice versa).
 * @module layers/faaStatus/records
 */

/** Local airports the layer pins. Coordinates are the FAA airport refs. */
export const FAA_STATUS_LOCAL_AIRPORTS = Object.freeze({
  ACY: Object.freeze({
    name: 'Atlantic City Intl',
    lat: 39.4576,
    lon: -74.5772,
  }),
  PHL: Object.freeze({
    name: 'Philadelphia Intl',
    lat: 39.8744,
    lon: -75.2424,
  }),
  EWR: Object.freeze({
    name: 'Newark Liberty Intl',
    lat: 40.6895,
    lon: -74.1745,
  }),
});

export const FAA_STATUS_LOCAL_CODES = Object.freeze(
  Object.keys(FAA_STATUS_LOCAL_AIRPORTS),
);

/** Event categories, in display order. */
export const FAA_STATUS_CATEGORIES = Object.freeze([
  'ground-stop',
  'ground-delay',
  'closure',
  'arrival-departure',
]);

const MONTHS = Object.freeze({
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
});

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function field(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeEntities(match[1]).trim() : null;
}

/** Category from a <Delay_type> <Name>; null when the block is unknown. */
function categoryForName(name) {
  if (/ground stop/i.test(name)) return 'ground-stop';
  if (/ground delay/i.test(name)) return 'ground-delay';
  if (/closure/i.test(name)) return 'closure';
  if (/arrival\/departure/i.test(name)) return 'arrival-departure';
  return null;
}

/**
 * Infer a UTC timestamp for a feed date with no year ("Nov 16 at 07:30
 * UTC."). A date more than six months away from the update month rolls
 * a year: Jan–Mar against an Oct–Dec update means next year.
 */
export function parseFeedDate(text, updateMs) {
  if (typeof text !== 'string') return null;
  const match = text.match(
    /([A-Za-z]{3}) (\d{1,2}) at (\d{1,2}):(\d{2}) UTC\.?/,
  );
  if (!match) return null;
  const month = MONTHS[match[1]];
  if (month === undefined) return null;
  const update = new Date(updateMs);
  let year = update.getUTCFullYear();
  const updateMonth = update.getUTCMonth();
  if (month - updateMonth > 6) year -= 1;
  else if (updateMonth - month > 6) year += 1;
  return Date.UTC(
    year,
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  );
}

function parseEntry(block, category, updateMs) {
  const airport = field(block, 'ARPT');
  if (!airport) return null;
  const event = {
    airport,
    category,
    reason: field(block, 'Reason'),
    start: field(block, 'Start'),
    reopen: field(block, 'Reopen'),
    endTime: field(block, 'End_Time'),
    avg: field(block, 'Avg'),
    max: field(block, 'Max'),
    trend: null,
    delayType: null,
    startMs: null,
    reopenMs: null,
  };
  if (category === 'arrival-departure') {
    const ad = block.match(
      /<Arrival_Departure(?:\s+Type="([^"]*)")?>([\s\S]*?)<\/Arrival_Departure>/,
    );
    if (ad) {
      event.delayType = ad[1] ?? null;
      event.avg = field(ad[2], 'Min');
      event.max = field(ad[2], 'Max');
      event.trend = field(ad[2], 'Trend');
    }
  }
  event.startMs = parseFeedDate(event.start, updateMs);
  event.reopenMs = parseFeedDate(event.reopen, updateMs);
  return event;
}

/**
 * Parse the NAS Status XML document.
 * @param {string} xmlText - Raw feed text.
 * @returns {{updateTime: string, updateTimeMs: number, local: Array, nationwide: Object, totalAirports: number}}
 * local holds only ACY/PHL/EWR events; nationwide counts every entry per
 * category; totalAirports counts distinct airport codes in the feed.
 */
export function parseNasStatusXml(xmlText) {
  if (
    typeof xmlText !== 'string' ||
    !xmlText.includes('<AIRPORT_STATUS_INFORMATION>')
  )
    throw new Error('Malformed FAA NAS Status feed');
  const updateTime = field(xmlText, 'Update_Time');
  if (!updateTime) throw new Error('Malformed FAA NAS Status feed');
  const updateTimeMs = Date.parse(updateTime);
  if (!Number.isFinite(updateTimeMs))
    throw new Error('Malformed FAA NAS Status feed');

  const local = [];
  const nationwide = {
    groundStop: 0,
    groundDelay: 0,
    closure: 0,
    arrivalDepartureDelay: 0,
  };
  const airports = new Set();
  const countKey = {
    'ground-stop': 'groundStop',
    'ground-delay': 'groundDelay',
    closure: 'closure',
    'arrival-departure': 'arrivalDepartureDelay',
  };

  const blocks = xmlText.match(/<Delay_type>[\s\S]*?<\/Delay_type>/g) ?? [];
  for (const block of blocks) {
    const category = categoryForName(field(block, 'Name') ?? '');
    if (!category) continue;
    const entryTags = ['Program', 'Ground_Delay', 'Airport', 'Delay'];
    for (const tag of entryTags) {
      const entries =
        block.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) ?? [];
      for (const entry of entries) {
        const event = parseEntry(entry, category, updateTimeMs);
        if (!event) continue;
        airports.add(event.airport);
        nationwide[countKey[category]] += 1;
        if (FAA_STATUS_LOCAL_CODES.includes(event.airport)) local.push(event);
      }
    }
  }

  return {
    updateTime,
    updateTimeMs,
    local,
    nationwide,
    totalAirports: airports.size,
  };
}
