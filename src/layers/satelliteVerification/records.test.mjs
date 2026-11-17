import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  copernicusBrowserUrl,
  countyTileUrl,
  gibsTileUrl,
  gibsTileUrlTemplate,
  isValidDateString,
  normalizeODataProduct,
  normalizeODataProducts,
  parseSentinelProductName,
  toDateString,
  validateSnapshot,
  worldviewUrl,
} from './records.js';

test('GIBS tile URL matches the live-verified tile (2026-11-16, HTTP 200)', () => {
  assert.equal(
    gibsTileUrl({
      sourceId: 'MODIS_Terra',
      date: '2026-11-16',
      z: 9,
      row: 195,
      col: 149,
    }),
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-16/GoogleMapsCompatible_Level9/9/195/149.jpg',
  );
  assert.equal(
    countyTileUrl({ sourceId: 'MODIS_Terra', date: '2026-11-16' }),
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-16/GoogleMapsCompatible_Level9/9/195/149.jpg',
  );
  assert.equal(
    gibsTileUrlTemplate({ sourceId: 'MODIS_Aqua', date: '2026-11-15' }),
    'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/2026-11-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
  );
  assert.throws(
    () => gibsTileUrl({ sourceId: 'NOPE', date: '2026-11-16', z: 9, row: 1, col: 1 }),
    /Unknown GIBS source/,
  );
  assert.throws(
    () => gibsTileUrl({ sourceId: 'MODIS_Terra', date: '16 Nov 2026', z: 9, row: 1, col: 1 }),
    /Invalid date/,
  );
});

test('date helpers: validation, UTC string, day arithmetic', () => {
  assert.equal(isValidDateString('2026-11-16'), true);
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-11-16T00:00:00Z'), false);
  assert.equal(isValidDateString(null), false);
  assert.equal(toDateString(new Date('2026-11-17T13:00:00.000Z')), '2026-11-17');
  assert.equal(addDays('2026-11-17', -1), '2026-11-16');
  assert.equal(addDays('2026-11-17', -7), '2026-11-10');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.throws(() => addDays('not-a-date', -1), /Invalid date/);
});

test('Sentinel-2 product names parse (S2A/S2B/S2C, L1C/L2A, tiles)', () => {
  // The real product returned live by the OData query, 2026-11-17.
  assert.deepEqual(
    parseSentinelProductName(
      'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
    ),
    { sensingDate: '2023-05-25', tile: 'T18SVJ', level: 'L1C' },
  );
  assert.deepEqual(
    parseSentinelProductName(
      'S2C_MSIL2A_20261115T155521_N0513_R054_T18SVJ_20261115T190903',
    ),
    { sensingDate: '2026-11-15', tile: 'T18SVJ', level: 'L2A' },
  );
  assert.deepEqual(
    parseSentinelProductName(
      'S2B_MSIL2A_20261115T155521_N0513_R054_T18SWJ_20261115T190903',
    ),
    { sensingDate: '2026-11-15', tile: 'T18SWJ', level: 'L2A' },
  );
  assert.deepEqual(parseSentinelProductName('not-a-product'), {
    sensingDate: null,
    tile: null,
    level: null,
  });
});

test('OData normalizer keeps the real T18SVJ product, drops the unusable', () => {
  const payload = {
    value: [
      {
        Id: 'e4de0c65-5ae6-4034-999c-a688454733b7',
        Name: 'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
        ContentDate: {
          Start: '2023-05-25T15:49:41.024000Z',
          End: '2023-05-25T15:49:41.024000Z',
        },
      },
      {
        Id: 'neighbour',
        Name: 'S2C_MSIL2A_20261115T155521_N0513_R054_T18SWJ_20261115T190903',
        ContentDate: { Start: '2026-11-15T15:55:21.025000Z' },
      },
      { Id: 'broken', Name: 'not-a-product' },
      null,
    ],
  };
  const products = normalizeODataProducts(payload);
  assert.equal(products.length, 2);
  assert.equal(products[0].id, 'e4de0c65-5ae6-4034-999c-a688454733b7');
  assert.equal(products[0].sensingDate, '2023-05-25');
  assert.equal(products[0].tile, 'T18SVJ');
  assert.equal(products[0].countyTile, true);
  assert.equal(products[1].tile, 'T18SWJ');
  assert.equal(products[1].countyTile, false);
  assert.equal(products[1].level, 'L2A');
  assert.deepEqual(normalizeODataProducts({}), []);
  assert.deepEqual(normalizeODataProducts(null), []);
  assert.equal(normalizeODataProduct(null), null);
});

test('link-outs frame the county + date', () => {
  assert.equal(
    worldviewUrl('2026-11-16'),
    'https://worldview.earthdata.nasa.gov/?v=-75.15,38.9,-74.55,39.35&l=MODIS_Terra_CorrectedReflectance_TrueColor&t=2026-11-16',
  );
  assert.equal(
    copernicusBrowserUrl('2026-11-16'),
    'https://browser.dataspace.copernicus.eu/?lat=39&lng=-74.9&zoom=10&datasetId=S2L2A&date=2026-11-16',
  );
});

test('snapshot validation catches a wrong shape', () => {
  const good = {
    requestedDate: '2026-11-17',
    date: '2026-11-16',
    source: 'MODIS_Terra',
    tileStatus: 'nearest',
    products: [],
  };
  assert.deepEqual(validateSnapshot(good), []);
  assert.deepEqual(validateSnapshot(null), ['snapshot']);
  assert.deepEqual(validateSnapshot({ ...good, tileStatus: 'maybe' }), [
    'tileStatus',
  ]);
  assert.deepEqual(validateSnapshot({ ...good, source: null }), ['source']);
  assert.deepEqual(validateSnapshot({ ...good, date: 'yesterday' }), ['date']);
});
