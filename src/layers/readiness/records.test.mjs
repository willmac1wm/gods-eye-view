import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READINESS_CHECKLISTS,
  activeDrivers,
  computeDrivers,
  goBagQuantities,
  goBagSummary,
  readinessItemIds,
  readinessRows,
  readinessStatusLabel,
  validateChecklists,
} from './records.js';
import { createReadinessStore, memoryStorage } from './store.js';

// The bundle is pinned against the Ready.gov pages fetched 2026-11-17
// (/kit: Basic Disaster Supplies Kit + Additional Emergency Supplies;
// /plan: Make A Plan, steps 1–4). Counts, not copies: the texts are short
// item summaries and the full guides live at ready.gov.
test('checklist bundle matches the Ready.gov pages', () => {
  assert.deepEqual(validateChecklists(), []);
  assert.equal(READINESS_CHECKLISTS.length, 3);
  const byId = Object.fromEntries(
    READINESS_CHECKLISTS.map((list) => [list.id, list]),
  );
  assert.equal(byId['basic-kit'].items.length, 14);
  assert.equal(byId['additional-supplies'].items.length, 8);
  assert.equal(byId['family-plan'].items.length, 5);
  assert.equal(readinessItemIds().length, 27);
  assert.equal(byId['basic-kit'].sourceUrl, 'https://www.ready.gov/kit');
  assert.equal(
    byId['additional-supplies'].sourceUrl,
    'https://www.ready.gov/kit',
  );
  assert.equal(byId['family-plan'].sourceUrl, 'https://www.ready.gov/plan');
  assert.equal(byId['basic-kit'].source, 'Ready.gov');
  const water = byId['basic-kit'].items.find((i) => i.id === 'water');
  assert.match(water.text, /1 gallon per person per day/);
  assert.equal(water.driver, 'drought');
  const radio = byId['basic-kit'].items.find((i) => i.id === 'radio');
  assert.deepEqual(radio.driver, ['storm', 'power']);
  const route = byId['family-plan'].items.find(
    (i) => i.id === 'evacuation-route',
  );
  assert.deepEqual(route.driver, ['flood', 'storm']);
});

test('flood driver fires on a flood alert, a flood tide stage, or 6.2 ft', () => {
  const alert = computeDrivers({
    nwsRecords: [{ event: 'Coastal Flood Advisory', severity: 'Moderate' }],
  });
  assert.equal(alert.flood.active, true);
  assert.match(alert.flood.reason, /Coastal Flood Advisory/);
  const stage = computeDrivers({
    tideRecords: [{ observedFtMllw: 5.0, floodStage: 'minor' }],
  });
  assert.equal(stage.flood.active, true);
  const level = computeDrivers({
    tideRecords: [{ observedFtMllw: 6.2, floodStage: 'none' }],
  });
  assert.equal(level.flood.active, true);
  assert.match(level.flood.reason, /6.2 ft/);
  const quiet = computeDrivers({
    tideRecords: [{ observedFtMllw: 3.1, floodStage: 'none' }],
  });
  assert.equal(quiet.flood.active, false);
  assert.equal(quiet.flood.reason, null);
});

test('storm driver fires on storm alerts and other warnings, not on fog', () => {
  assert.equal(
    computeDrivers({
      nwsRecords: [{ event: 'Hurricane Warning', severity: 'Extreme' }],
    }).storm.active,
    true,
  );
  assert.equal(
    computeDrivers({
      nwsRecords: [{ event: 'High Wind Warning', severity: 'Severe' }],
    }).storm.active,
    true,
  );
  assert.equal(
    computeDrivers({
      nwsRecords: [{ event: 'Dense Fog Advisory', severity: 'Moderate' }],
    }).storm.active,
    false,
  );
  // A flood warning is flood, not storm.
  const flood = computeDrivers({
    nwsRecords: [{ event: 'Flood Warning', severity: 'Severe' }],
  });
  assert.equal(flood.flood.active, true);
  assert.equal(flood.storm.active, false);
});

test('cold driver fires on freeze alerts only', () => {
  assert.equal(
    computeDrivers({
      nwsRecords: [{ event: 'Freeze Warning', severity: 'Moderate' }],
    }).cold.active,
    true,
  );
  assert.equal(
    computeDrivers({
      nwsRecords: [{ event: 'Heat Advisory', severity: 'Moderate' }],
    }).cold.active,
    false,
  );
});

test('power driver fires at 1,000 customers out (the D4 Power rule)', () => {
  assert.equal(
    computeDrivers({
      outageRecords: [{ customersOut: 600 }, { customersOut: 400 }],
    }).power.active,
    true,
  );
  assert.equal(
    computeDrivers({ outageRecords: [{ customersOut: 999 }] }).power.active,
    false,
  );
});

test('drought driver fires at D2, space driver at Kp 5 or a G-scale reading', () => {
  assert.equal(
    computeDrivers({ droughtRecords: [{ category: 2 }] }).drought.active,
    true,
  );
  assert.equal(
    computeDrivers({ droughtRecords: [{ category: 1 }] }).drought.active,
    false,
  );
  assert.equal(
    computeDrivers({ spaceRecords: [{ kp: 5 }] }).space.active,
    true,
  );
  assert.equal(
    computeDrivers({ spaceRecords: [{ kp: 4, gScale: 'G1' }] }).space.active,
    true,
  );
  assert.equal(
    computeDrivers({ spaceRecords: [{ kp: 4 }] }).space.active,
    false,
  );
});

test('activeDrivers lists only the active ones, in policy order', () => {
  const drivers = computeDrivers({
    nwsRecords: [{ event: 'Coastal Flood Advisory', severity: 'Moderate' }],
    spaceRecords: [{ kp: 6 }],
  });
  assert.deepEqual(activeDrivers(drivers), ['flood', 'space']);
});

test('readinessRows marks due items with their live reasons', () => {
  const drivers = computeDrivers({
    nwsRecords: [{ event: 'Coastal Flood Advisory', severity: 'Moderate' }],
    outageRecords: [{ customersOut: 1200 }],
  });
  const rows = readinessRows(READINESS_CHECKLISTS, drivers);
  assert.equal(rows.length, 27);
  const maps = rows.find((r) => r.id === 'basic-kit:maps');
  assert.equal(maps.due, true);
  assert.deepEqual(maps.dueReasons, ['Coastal Flood Advisory']);
  const flashlight = rows.find((r) => r.id === 'basic-kit:flashlight');
  assert.equal(flashlight.due, true);
  assert.match(flashlight.dueReasons[0], /1,200 customers out/);
  const food = rows.find((r) => r.id === 'basic-kit:food');
  assert.equal(food.due, false);
  assert.deepEqual(food.dueReasons, []);
});

test('go-bag math: household of 4 → 12 gallons of water for 3 days', () => {
  assert.deepEqual(goBagQuantities(4), {
    householdSize: 4,
    days: 3,
    waterGallons: 12,
    food: '3-day supply × 4 people',
  });
  assert.equal(goBagQuantities(1).waterGallons, 3);
  assert.equal(goBagQuantities(1).food, '3-day supply × 1 person');
  assert.equal(goBagQuantities(0).householdSize, 1);
  assert.equal(goBagQuantities(99).householdSize, 12);
  assert.equal(goBagQuantities(Number.NaN).householdSize, 4);
  assert.equal(
    goBagSummary(4),
    'Go-bag for 4: 12 gal water · 3-day supply × 4 people',
  );
});

test('readinessStatusLabel: due count, unavailable, baseline', () => {
  assert.equal(readinessStatusLabel({ dueCount: 1 }), '1 item due now');
  assert.equal(readinessStatusLabel({ dueCount: 3 }), '3 items due now');
  assert.equal(
    readinessStatusLabel({ dueCount: 0, unavailable: ['nws'] }),
    'live status unavailable',
  );
  assert.equal(readinessStatusLabel({ dueCount: 0 }), 'baseline kit');
});

test('done-state store is local-only and tolerates a corrupt store', () => {
  const store = createReadinessStore({ storage: memoryStorage() });
  assert.equal(store.isDone('basic-kit:water'), false);
  assert.equal(store.toggle('basic-kit:water'), true);
  assert.equal(store.isDone('basic-kit:water'), true);
  assert.deepEqual(store.doneIds(), ['basic-kit:water']);
  assert.equal(store.toggle('basic-kit:water'), false);
  store.toggle('basic-kit:food');
  store.clear();
  assert.deepEqual(store.doneIds(), []);
  const corrupt = memoryStorage();
  corrupt.setItem('cape-dispatch:readiness:done:v1', '{not json');
  const broken = createReadinessStore({ storage: corrupt });
  assert.equal(broken.isDone('basic-kit:water'), false);
  assert.equal(broken.toggle('basic-kit:water'), true);
});
