// src/layers/outbreaks/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countiesWithHumanCases,
  normalizeArbonetCountyRow,
  normalizeArbonetStateRow,
  normalizeDonItem,
  normalizeOutbreaksSnapshot,
  sortArbonetCountyRows,
  sortArbonetStateRows,
  sortDonItems,
} from './records.js';

// Verbatim live CDC rows from 2026-11-17 (CountbyState + hum_nonhum CSVs).
const NJ_STATE_ROW = { state: 'NJ', cases: 35, band: '>25' };
const CA_STATE_ROW = { state: 'CA', cases: 527, band: '>25' };
const CAPE_MAY_COUNTY_ROW = {
  fips: '34009',
  activity: 'Non-human activity',
  humanCases: 0,
  neuroinvasive: 0,
  donors: 0,
};
const ATLANTIC_COUNTY_ROW = {
  fips: '34001',
  activity: 'Human infections and non-human activity',
  humanCases: 2,
  neuroinvasive: 2,
  donors: 0,
};
const CAMDEN_COUNTY_ROW = {
  fips: '34007',
  activity: 'Human infections and non-human activity',
  humanCases: 6,
  neuroinvasive: 4,
  donors: 2,
};

// Verbatim live WHO DON items from 2026-11-17 (OData feed).
const MERS_DON = {
  id: 'DON626',
  title: 'Middle East respiratory syndrome (MERS) – Qatar',
  date: '13 November 2026',
  dateIso: '2026-11-13T00:00:00.000Z',
  url: 'https://www.who.int/2026-DON626',
};
const EBOLA_DON = {
  id: 'DON625',
  title:
    'Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo, Kenya and Nigeria',
  date: '6 November 2026',
  dateIso: '2026-11-06T00:00:00.000Z',
  url: 'https://www.who.int/2026-DON625',
};

function livePayload() {
  return {
    fetchedAt: 1_793_123_456_789,
    stale: false,
    ttlMs: 86_400_000,
    arbonet: {
      ok: true,
      asOf: 'November 10, 2026',
      status: 'preliminary',
      states: [NJ_STATE_ROW, CA_STATE_ROW],
      njCounties: [CAPE_MAY_COUNTY_ROW, ATLANTIC_COUNTY_ROW, CAMDEN_COUNTY_ROW],
    },
    don: { ok: true, items: [MERS_DON, EBOLA_DON] },
  };
}

test('a New Jersey state row normalizes with its CDC band', () => {
  const row = normalizeArbonetStateRow(NJ_STATE_ROW);
  assert.equal(row.kind, 'state');
  assert.equal(row.state, 'NJ');
  assert.equal(row.cases, 35);
  assert.equal(row.band, '>25');
  assert.equal(row.source, 'CDC ArboNET');
  assert.equal(normalizeArbonetStateRow({ state: 'NJ' }), null);
  assert.equal(normalizeArbonetStateRow({ state: 'NJ', cases: 'x' }), null);
  assert.equal(normalizeArbonetStateRow(null), null);
});

test('the Cape May County row normalizes: non-human activity, zero human cases', () => {
  const row = normalizeArbonetCountyRow(CAPE_MAY_COUNTY_ROW);
  assert.equal(row.kind, 'county');
  assert.equal(row.fips, '34009');
  assert.equal(row.county, 'Cape May');
  assert.equal(row.activity, 'Non-human activity');
  assert.equal(row.humanCases, 0);
  assert.equal(row.neuroinvasive, 0);
  assert.equal(row.donors, 0);
  assert.equal(row.source, 'CDC ArboNET');
  assert.equal(
    normalizeArbonetCountyRow({ ...CAPE_MAY_COUNTY_ROW, humanCases: 'x' }),
    null,
  );
});

test('a county FIPS outside New Jersey keeps a null name', () => {
  const row = normalizeArbonetCountyRow({
    fips: '01001',
    activity: 'Human infections',
    humanCases: 1,
    neuroinvasive: 1,
    donors: 0,
  });
  assert.equal(row.county, null);
  assert.equal(row.humanCases, 1);
});

test('a WHO DON item normalizes with its id and date', () => {
  const row = normalizeDonItem(MERS_DON);
  assert.equal(row.kind, 'don');
  assert.equal(row.id, 'DON626');
  assert.equal(row.title, 'Middle East respiratory syndrome (MERS) – Qatar');
  assert.equal(row.date, '13 November 2026');
  assert.equal(row.source, 'WHO DON');
  assert.equal(normalizeDonItem({ id: 'DON626' }), null);
  assert.equal(normalizeDonItem({ title: 'x' }), null);
  assert.equal(normalizeDonItem(null), null);
});

test('the live snapshot validates: NJ 35, Cape May zero, 2 DONs', () => {
  const snapshot = normalizeOutbreaksSnapshot(livePayload());
  assert.equal(snapshot.counts.states, 2);
  assert.equal(snapshot.counts.njCounties, 3);
  assert.equal(snapshot.counts.don, 2);
  assert.equal(snapshot.counts.njCases, 35);
  assert.equal(snapshot.counts.capeMayHumanCases, 0);
  assert.equal(snapshot.capeMay.county, 'Cape May');
  assert.equal(snapshot.arbonet.asOf, 'November 10, 2026');
  assert.equal(snapshot.arbonet.status, 'preliminary');
  assert.equal(snapshot.don.items[0].id, 'DON626');
});

test('a malformed payload never partially validates', () => {
  assert.equal(normalizeOutbreaksSnapshot(null), null);
  assert.equal(normalizeOutbreaksSnapshot({ nope: true }), null);
  assert.equal(
    normalizeOutbreaksSnapshot({ ...livePayload(), fetchedAt: 'soon' }),
    null,
  );
  const noDon = livePayload();
  delete noDon.don;
  assert.equal(normalizeOutbreaksSnapshot(noDon), null);
  const badRows = livePayload();
  badRows.arbonet.states = 'nope';
  assert.equal(normalizeOutbreaksSnapshot(badRows), null);
});

test('an empty season is a valid snapshot, not an error', () => {
  const payload = livePayload();
  payload.arbonet.states = [];
  payload.arbonet.njCounties = [];
  payload.don.items = [];
  const snapshot = normalizeOutbreaksSnapshot(payload);
  assert.equal(snapshot.counts.states, 0);
  assert.equal(snapshot.counts.njCases, null);
  assert.equal(snapshot.capeMay, null);
});

test('sorts rank states by cases, counties by human cases, DONs newest first', () => {
  assert.deepEqual(
    sortArbonetStateRows([NJ_STATE_ROW, CA_STATE_ROW].map(normalizeArbonetStateRow)).map(
      (row) => row.state,
    ),
    ['CA', 'NJ'],
  );
  assert.deepEqual(
    sortArbonetCountyRows(
      [CAPE_MAY_COUNTY_ROW, ATLANTIC_COUNTY_ROW, CAMDEN_COUNTY_ROW].map(
        normalizeArbonetCountyRow,
      ),
    ).map((row) => row.county),
    ['Camden', 'Atlantic', 'Cape May'],
  );
  assert.deepEqual(
    countiesWithHumanCases(
      [CAPE_MAY_COUNTY_ROW, ATLANTIC_COUNTY_ROW, CAMDEN_COUNTY_ROW].map(
        normalizeArbonetCountyRow,
      ),
    ).map((row) => row.county),
    ['Camden', 'Atlantic'],
  );
  assert.deepEqual(
    sortDonItems([EBOLA_DON, MERS_DON].map(normalizeDonItem)).map(
      (row) => row.id,
    ),
    ['DON626', 'DON625'],
  );
});
