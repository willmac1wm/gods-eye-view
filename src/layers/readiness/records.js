import checklistsData from './checklists.json' with { type: 'json' };
import {
  READINESS_DRIVERS,
  READINESS_DROUGHT_CATEGORY,
  READINESS_GO_BAG_DAYS,
  READINESS_KP,
  READINESS_OUTAGES_CUSTOMERS,
  READINESS_TIDE_MINOR_FT,
  READINESS_WATER_GALLONS_PER_PERSON_PER_DAY,
} from './policy.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/** The bundled checklists, exactly as curated in checklists.json. */
export const READINESS_CHECKLISTS = Object.freeze(
  (checklistsData?.checklists ?? []).map((list) => ({
    id: list.id,
    title: list.title,
    source: list.source,
    sourceUrl: list.sourceUrl,
    items: (list.items ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      driver: item.driver ?? null,
    })),
  })),
);

/** All item ids, qualified as `<checklist>:<item>` (the done-state keys). */
export function readinessItemIds(checklists = READINESS_CHECKLISTS) {
  const ids = [];
  for (const list of checklists ?? []) {
    for (const item of list?.items ?? []) {
      ids.push(`${list.id}:${item.id}`);
    }
  }
  return ids;
}

/**
 * Validate the bundled checklist shape. Returns a list of problems; empty
 * means the bundle is well formed. The tests pin the counts against the
 * Ready.gov pages; this guards the shape (unique ids, known drivers).
 */
export function validateChecklists(checklists = READINESS_CHECKLISTS) {
  const errors = [];
  if (!Array.isArray(checklists) || checklists.length === 0) {
    return ['no checklists'];
  }
  const seen = new Set();
  for (const list of checklists) {
    if (!list?.id || !list?.title || !Array.isArray(list?.items)) {
      errors.push(`malformed checklist: ${list?.id ?? '(no id)'}`);
      continue;
    }
    if (!list?.sourceUrl)
      errors.push(`checklist without sourceUrl: ${list.id}`);
    for (const item of list.items) {
      if (!item?.id || !item?.text) {
        errors.push(`malformed item in ${list.id}`);
        continue;
      }
      const key = `${list.id}:${item.id}`;
      if (seen.has(key)) errors.push(`duplicate item id: ${key}`);
      seen.add(key);
      const drivers = item.driver == null ? [] : [].concat(item.driver);
      for (const driver of drivers) {
        if (!READINESS_DRIVERS.includes(driver)) {
          errors.push(`unknown driver ${driver} on ${key}`);
        }
      }
    }
  }
  return errors;
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** Warning / watch / advisory from an NWS event name + severity. */
export function classifyNwsAlert(record) {
  const event = String(record?.event ?? '');
  const severity = String(record?.severity ?? '');
  if (/Warning/i.test(event) || severity === 'Extreme' || severity === 'Severe')
    return 'warning';
  if (/Watch/i.test(event)) return 'watch';
  if (/Advisory/i.test(event) || /Statement/i.test(event)) return 'advisory';
  return null;
}

function eventMatches(event, pattern) {
  return pattern.test(String(event ?? ''));
}

/**
 * Compute the six live drivers from the normalized layer inputs. Pure.
 *
 * inputs: { nwsRecords, tideRecords, outageRecords, droughtRecords,
 * spaceRecords } — analyst records as the layers return them (see
 * countyRisk/inputs.js for the same shapes). Each driver is
 * { active, reason } — reason names the top live fact, or null. A driver
 * with no data at all is inactive with reason null; the caller marks it
 * unavailable separately (a missing layer is never "all clear").
 */
export function computeDrivers(inputs = {}) {
  const nwsRecords = Array.isArray(inputs?.nwsRecords) ? inputs.nwsRecords : [];
  const tideRecords = Array.isArray(inputs?.tideRecords)
    ? inputs.tideRecords
    : [];
  const outageRecords = Array.isArray(inputs?.outageRecords)
    ? inputs.outageRecords
    : [];
  const droughtRecords = Array.isArray(inputs?.droughtRecords)
    ? inputs.droughtRecords
    : [];
  const spaceRecords = Array.isArray(inputs?.spaceRecords)
    ? inputs.spaceRecords
    : [];

  const drivers = {};
  for (const name of READINESS_DRIVERS) {
    drivers[name] = { active: false, reason: null };
  }

  // Flood: a flood alert, or the tide at/above the minor-flood line.
  const floodEvents = [];
  for (const record of nwsRecords) {
    const event = String(record?.event ?? '').trim();
    if (eventMatches(event, /flood/i)) floodEvents.push(event);
  }
  let tideFt = null;
  let tideStage = null;
  for (const record of tideRecords) {
    const level = num(record?.observedFtMllw);
    if (level !== null && (tideFt === null || level > tideFt)) tideFt = level;
    const stage = String(record?.floodStage ?? '');
    if (['minor', 'moderate', 'major'].includes(stage)) tideStage = stage;
  }
  if (floodEvents.length > 0) {
    drivers.flood = { active: true, reason: floodEvents[0] };
  } else if (tideStage !== null) {
    drivers.flood = { active: true, reason: `Tide flood stage: ${tideStage}` };
  } else if (tideFt !== null && tideFt >= READINESS_TIDE_MINOR_FT) {
    drivers.flood = { active: true, reason: `Tide ${tideFt.toFixed(1)} ft` };
  }

  // Storm: a storm-named alert, or any warning that is not flood/cold.
  const stormEvents = [];
  let otherWarning = null;
  for (const record of nwsRecords) {
    const event = String(record?.event ?? '').trim();
    if (!event) continue;
    if (
      eventMatches(
        event,
        /hurricane|tropical|severe thunderstorm|tornado|high wind|winter storm|blizzard|ice storm/i,
      )
    ) {
      stormEvents.push(event);
      continue;
    }
    if (
      classifyNwsAlert(record) === 'warning' &&
      !eventMatches(event, /flood/i) &&
      !eventMatches(event, /freeze|frost|wind chill|extreme cold/i)
    ) {
      otherWarning ??= event;
    }
  }
  if (stormEvents.length > 0) {
    drivers.storm = { active: true, reason: stormEvents[0] };
  } else if (otherWarning !== null) {
    drivers.storm = { active: true, reason: otherWarning };
  }

  // Cold: a freeze / frost / wind-chill alert.
  const coldEvents = [];
  for (const record of nwsRecords) {
    const event = String(record?.event ?? '').trim();
    if (eventMatches(event, /freeze|frost|wind chill|extreme cold/i)) {
      coldEvents.push(event);
    }
  }
  if (coldEvents.length > 0) {
    drivers.cold = { active: true, reason: coldEvents[0] };
  }

  // Power: 1,000+ customers out across the county (the D4 Power rule).
  let customersOut = 0;
  for (const record of outageRecords) {
    customersOut += num(record?.customersOut) ?? 0;
  }
  if (customersOut >= READINESS_OUTAGES_CUSTOMERS) {
    drivers.power = {
      active: true,
      reason: `${customersOut.toLocaleString('en-US')} customers out`,
    };
  }

  // Drought: U.S. Drought Monitor category D2 (Severe) or worse.
  let maxCategory = null;
  for (const record of droughtRecords) {
    const category = num(record?.category);
    if (category !== null && (maxCategory === null || category > maxCategory)) {
      maxCategory = category;
    }
  }
  if (maxCategory !== null && maxCategory >= READINESS_DROUGHT_CATEGORY) {
    drivers.drought = { active: true, reason: `Drought D${maxCategory}` };
  }

  // Space: Kp 5+ (G1) or a G-scale reading.
  let maxKp = null;
  let gScale = null;
  for (const record of spaceRecords) {
    const kp = num(record?.kp);
    if (kp !== null && (maxKp === null || kp > maxKp)) maxKp = kp;
    const scale = String(record?.gScale ?? '').trim();
    if (scale) gScale ??= scale;
  }
  if (maxKp !== null && maxKp >= READINESS_KP) {
    drivers.space = { active: true, reason: `Kp ${maxKp}` };
  } else if (gScale !== null) {
    drivers.space = { active: true, reason: `Geomagnetic storm ${gScale}` };
  }

  return drivers;
}

/** Drivers that are active, in READINESS_DRIVERS order. */
export function activeDrivers(drivers = {}) {
  return READINESS_DRIVERS.filter((name) => drivers?.[name]?.active === true);
}

/**
 * Flatten the checklists into rows with their due state. A row is due
 * when any of its drivers is active; `dueReasons` names the live facts.
 * Rows are returned checklist by checklist, in bundle order.
 */
export function readinessRows(checklists = READINESS_CHECKLISTS, drivers = {}) {
  const rows = [];
  for (const list of checklists ?? []) {
    for (const item of list?.items ?? []) {
      const itemDrivers = item?.driver == null ? [] : [].concat(item.driver);
      const reasons = itemDrivers
        .filter((name) => drivers?.[name]?.active === true)
        .map((name) => drivers[name].reason)
        .filter(Boolean);
      rows.push({
        id: `${list.id}:${item.id}`,
        checklistId: list.id,
        checklistTitle: list.title,
        text: item.text,
        drivers: itemDrivers,
        due: reasons.length > 0,
        dueReasons: reasons,
      });
    }
  }
  return rows;
}

/**
 * Go-bag quantities for a household size (Ready.gov: 1 gallon of water
 * per person per day, 3 days). Household of 4 → 12 gallons of water.
 */
export function goBagQuantities(householdSize) {
  const size = Number.isFinite(householdSize)
    ? Math.max(1, Math.min(12, Math.floor(householdSize)))
    : 4;
  return {
    householdSize: size,
    days: READINESS_GO_BAG_DAYS,
    waterGallons:
      size * READINESS_WATER_GALLONS_PER_PERSON_PER_DAY * READINESS_GO_BAG_DAYS,
    food: `${READINESS_GO_BAG_DAYS}-day supply × ${size} ${size === 1 ? 'person' : 'people'}`,
  };
}

/** One-line go-bag summary for the info line. */
export function goBagSummary(householdSize) {
  const bag = goBagQuantities(householdSize);
  return (
    `Go-bag for ${bag.householdSize}: ${bag.waterGallons} gal water · ` +
    `${bag.food}`
  );
}

/** One-line status for the summary label ("3 items due now", "baseline", ...). */
export function readinessStatusLabel({ dueCount = 0, unavailable = [] } = {}) {
  if (dueCount > 0) {
    return dueCount === 1
      ? `1 ${msg('item due now')}`
      : `${dueCount} ${msg('items due now')}`;
  }
  if (unavailable.length > 0) return msg('live status unavailable');
  return msg('baseline kit');
}
