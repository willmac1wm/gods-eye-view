import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSatelliteCompareEntry,
  createSatelliteSummaryEntry,
  gibsLabel,
  mapAnalystRecord,
} from './model.js';

const LIVE_SNAPSHOT = {
  requestedDate: '2026-11-16',
  date: '2026-11-16',
  source: 'MODIS_Terra',
  tileStatus: 'live',
  products: [
    {
      id: 'e4de0c65-5ae6-4034-999c-a688454733b7',
      name: 'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
      sensingDate: '2023-05-25',
      tile: 'T18SVJ',
      level: 'L1C',
      countyTile: true,
    },
  ],
  catalogueAvailable: true,
};

test('summary entry carries the live date + source', () => {
  const entry = createSatelliteSummaryEntry({ snapshot: LIVE_SNAPSHOT });
  assert.match(entry.title, /2026-11-16/);
  assert.match(entry.title, /MODIS Terra/);
  assert.ok(entry.details.some((d) => d.includes('requested date')));
  assert.ok(entry.details.some((d) => d.includes('Sentinel-2 products')));
  assert.equal(entry.variant, 'label');
  assert.equal(entry.id, 'satellite-verification');
});

test('a nearest-date snapshot says so, never passing it off as requested', () => {
  const entry = createSatelliteSummaryEntry({
    snapshot: {
      ...LIVE_SNAPSHOT,
      requestedDate: '2026-11-17',
      date: '2026-11-16',
      tileStatus: 'nearest',
    },
  });
  assert.match(entry.title, /2026-11-16/);
  assert.ok(
    entry.details.some((d) => d.includes('Nearest imagery available')),
  );
  assert.ok(entry.details.some((d) => d.includes('2026-11-17')));
});

test('no imagery says so; a dead catalogue says so', () => {
  const entry = createSatelliteSummaryEntry({
    snapshot: {
      requestedDate: '2026-11-17',
      date: null,
      source: null,
      tileStatus: 'none',
      products: [],
      catalogueAvailable: false,
    },
  });
  assert.match(entry.title, /No imagery/);
  assert.match(entry.title, /2026-11-17/);
  assert.ok(
    entry.details.some((d) => d.includes('catalogue unavailable')),
  );
});

test('compare entry only exists for a real B date', () => {
  const entry = createSatelliteCompareEntry({
    snapshot: { ...LIVE_SNAPSHOT, date: '2026-11-09' },
  });
  assert.match(entry.title, /Compare/);
  assert.match(entry.title, /2026-11-09/);
  assert.equal(
    createSatelliteCompareEntry({
      snapshot: { ...LIVE_SNAPSHOT, tileStatus: 'none' },
    }),
    null,
  );
  assert.equal(createSatelliteCompareEntry({ snapshot: null }), null);
});

test('GIBS labels are human-readable', () => {
  assert.equal(gibsLabel('MODIS_Terra'), 'MODIS Terra');
  assert.equal(gibsLabel('MODIS_Aqua'), 'MODIS Aqua');
  assert.equal(gibsLabel('VIIRS_NOAA20'), 'VIIRS NOAA-20');
  assert.equal(gibsLabel('UNKNOWN'), 'UNKNOWN');
});

test('analyst record is one row per product, JSON-safe', () => {
  const record = mapAnalystRecord(LIVE_SNAPSHOT.products[0], 0);
  assert.equal(record.id, 'e4de0c65-5ae6-4034-999c-a688454733b7');
  assert.equal(record.sensingDate, '2023-05-25');
  assert.equal(record.tile, 'T18SVJ');
  assert.equal(record.level, 'L1C');
  assert.equal(record.countyTile, true);
  assert.equal(JSON.parse(JSON.stringify(record)).id, record.id);
  const fallback = mapAnalystRecord({}, 3);
  assert.equal(fallback.id, 'SENTINEL-0003');
  assert.equal(fallback.sensingDate, null);
});
