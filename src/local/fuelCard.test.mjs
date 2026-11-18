import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FUEL_LINKS,
  fuelAgeDays,
  fuelDetailsRecord,
  fuelTickerItem,
  weekText,
} from './fuelCard.js';

const NOW = Date.parse('2026-11-18T04:00:00Z');

// The shape createEiaFuelSource().getSnapshot() resolves (live values of
// 2026-11-17).
const FUEL_SNAPSHOT = Object.freeze({
  fetchedAt: Date.parse('2026-11-18T03:40:00Z'),
  stale: false,
  latestWeek: '2026-11-16',
  latest: {
    EMM_EPMR_PTE_R1Y_DPG: { period: '2026-11-16', value: 4.064 },
    EMD_EPD2D_PTE_R1Y_DPG: { period: '2026-11-16', value: 6.309 },
    EMM_EPMR_PTE_NUS_DPG: { period: '2026-11-16', value: 3.805 },
    EMD_EPD2D_PTE_NUS_DPG: { period: '2026-11-16', value: 5.937 },
    W_EPD2F_PRS_SNJ_DPG: { period: '2026-11-09', value: 6.052 },
  },
  heatingOil: { state: 'current', ageDays: 8 },
});

test('the GAS item is the Mid-Atlantic regular price, labelled as an average', () => {
  const item = fuelTickerItem(FUEL_SNAPSHOT, NOW);
  assert.deepEqual(
    { ...item, title: undefined },
    {
      key: 'fuel',
      layerId: 'fuel-prices',
      label: 'GAS',
      value: '$4.06',
      detail: 'Mid-Atlantic avg',
      tone: 'ok',
      title: undefined,
    },
  );
  assert.match(
    item.title,
    /Mid-Atlantic weekly average \(U\.S\. EIA\), week of Nov 16\./,
  );
  assert.match(item.title, /local station prices/);
});

test('an old week or a stale server copy mutes GAS; no price means no item', () => {
  const old = structuredClone(FUEL_SNAPSHOT);
  old.latest.EMM_EPMR_PTE_R1Y_DPG.period = '2026-10-26';
  assert.equal(fuelTickerItem(old, NOW).tone, 'muted');
  assert.match(fuelTickerItem(old, NOW).title, /not current/);
  assert.equal(
    fuelTickerItem({ ...FUEL_SNAPSHOT, stale: true }, NOW).tone,
    'muted',
  );
  assert.equal(fuelTickerItem(null, NOW), null);
  assert.equal(fuelTickerItem({ latest: {} }, NOW), null);
  const blank = structuredClone(FUEL_SNAPSHOT);
  blank.latest.EMM_EPMR_PTE_R1Y_DPG.value = null;
  assert.equal(fuelTickerItem(blank, NOW), null);
});

test('the card shows the weekly averages and links to local station prices', () => {
  const record = fuelDetailsRecord(FUEL_SNAPSHOT, NOW);
  assert.equal(record.kindLabel, 'Gas prices');
  assert.equal(record.title, 'Gas $4.06 · Diesel $6.31');
  assert.equal(record.subtitle, 'Mid-Atlantic weekly average · week of Nov 16');
  assert.equal(record.status, 'official');
  assert.deepEqual(record.fields, [
    ['Regular, Mid-Atlantic', '$4.06'],
    ['Diesel, Mid-Atlantic', '$6.31'],
    ['Regular, U.S. average', '$3.81'],
    ['Diesel, U.S. average', '$5.94'],
    ['Heating oil, New Jersey', '$6.05 · week of Nov 9'],
  ]);
  assert.match(record.note, /no county or New Jersey gas price/);
  assert.equal(record.linksLabel, 'Local station prices');
  assert.equal(record.links, FUEL_LINKS);
  assert.equal(record.sourceUrl, 'https://www.eia.gov/petroleum/gasdiesel/');
  assert.equal(record.fetchedAt, FUEL_SNAPSHOT.fetchedAt);
});

test('the station links are plain https pages, opened by the visitor, never fetched', () => {
  assert.deepEqual(
    FUEL_LINKS.map(({ href }) => new URL(href).host),
    ['www.gasbuddy.com', 'www.google.com'],
  );
  assert.equal(
    FUEL_LINKS[0].href,
    'https://www.gasbuddy.com/gasprices/new-jersey/cape-may/1496',
  );
  // A keyless Google Maps URL: no API key may ever ride along.
  const maps = new URL(FUEL_LINKS[1].href);
  assert.equal(maps.pathname, '/maps/search/');
  assert.equal(maps.searchParams.get('api'), '1');
  assert.equal(
    maps.searchParams.get('query'),
    'gas stations Cape May County, NJ',
  );
  assert.equal(maps.searchParams.has('key'), false);
  assert.ok(Object.isFrozen(FUEL_LINKS) && FUEL_LINKS.every(Object.isFrozen));
});

test('with no prices the card still opens, marked unavailable, with the links', () => {
  const record = fuelDetailsRecord(null, NOW);
  assert.equal(record.title, 'Gas prices');
  assert.equal(record.status, 'unavailable');
  assert.equal(record.subtitle, 'Weekly averages are not available right now');
  assert.match(record.note, /are not loading right now/);
  assert.doesNotMatch(record.note, /^These are/);
  assert.ok(record.fields.every(([, value]) => value === null));
  assert.equal(record.links.length, 2);
  assert.equal(record.fetchedAt, null);
});

test('an old week reads delayed, and an ended heating season says so', () => {
  const old = structuredClone(FUEL_SNAPSHOT);
  old.latest.EMM_EPMR_PTE_R1Y_DPG.period = '2026-10-26';
  old.heatingOil = { state: 'season-ended', ageDays: 200 };
  old.latest.W_EPD2F_PRS_SNJ_DPG.period = '2026-03-30';
  const record = fuelDetailsRecord(old, NOW);
  assert.equal(record.status, 'delayed');
  assert.equal(
    record.fields.find(([name]) => name === 'Heating oil, New Jersey')[1],
    '$6.05 · week of Mar 30 · last season',
  );
  assert.equal(
    fuelDetailsRecord({ ...FUEL_SNAPSHOT, stale: true }, NOW).status,
    'delayed',
  );
});

test('week text and age read EIA week periods and reject anything else', () => {
  assert.equal(weekText('2026-11-16'), 'Nov 16');
  assert.equal(weekText('2026-1-6'), null);
  assert.equal(weekText(null), null);
  assert.equal(fuelAgeDays('2026-11-16', NOW), 1);
  assert.equal(fuelAgeDays('2026-11-19', NOW), 0);
  assert.equal(fuelAgeDays('soon', NOW), null);
});
