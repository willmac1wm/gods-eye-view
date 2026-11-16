import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFloodTile,
  floodTilesProxy,
  levelForTile,
  roundLevel,
  serviceForLevel,
  tileCenter,
  emptyTilePng,
} from './floodTiles.js';
import { decodePng, encodePng } from './common/png.js';

const NOW = Date.parse('2026-11-16T13:15:00Z');
const NWPS_ACYN4 = {
  lid: 'ACYN4',
  status: {
    observed: {
      primary: 2.61,
      floodCategory: 'no_flooding',
      validTime: '2026-11-16T12:36:00Z',
    },
    forecast: {
      primary: 4.8,
      floodCategory: 'no_flooding',
      validTime: '2026-11-16T17:00:00Z',
    },
  },
  flood: {
    categories: {
      action: { stage: -9999 },
      minor: { stage: 6 },
      moderate: { stage: 7 },
      major: { stage: 8 },
    },
  },
};

function coopsRange(rows) {
  return {
    metadata: { id: '8536110' },
    data: rows.map(([t, v]) => ({ t, v: String(v) })),
  };
}

function coopsPreds(nextHigh) {
  return {
    predictions: [
      { t: '2026-11-16 05:45', v: '3.841', type: 'H' },
      { t: '2026-11-16 11:36', v: '1.054', type: 'L' },
      { t: '2026-11-16 18:04', v: String(nextHigh), type: 'H' },
      { t: '2026-11-17 00:28', v: '0.888', type: 'L' },
    ],
  };
}

// 4x2 RGBA level tile: water, dry, green (disconnected), white / dry, water, dark, half.
const LEVEL_RGBA = [
  37, 99, 235, 255, 0, 0, 0, 0, 0, 255, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0,
  37, 99, 235, 255, 10, 20, 30, 40, 0, 0, 0, 128,
];
const LEVEL_PNG = encodePng({
  width: 4,
  height: 2,
  data: Buffer.from(LEVEL_RGBA),
});
const BASE_PNG = encodePng({
  width: 4,
  height: 2,
  data: Buffer.alloc(4 * 2 * 4),
});

function stubFetch({ nextHigh = 4.779 } = {}) {
  const calls = [];
  const range = [];
  for (let m = 0; m <= 114; m += 6) {
    const at = new Date(Date.parse('2026-11-16T11:18:00Z') + m * 60_000);
    const hh = String(at.getUTCHours()).padStart(2, '0');
    const mm = String(at.getUTCMinutes()).padStart(2, '0');
    range.push([`2026-11-16 ${hh}:${mm}`, (1.85 + m * 0.005).toFixed(3)]);
  }
  range[range.length - 1][1] = '2.507';
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const text = String(url);
    if (text.includes('api.water.noaa.gov')) {
      if (text.endsWith('/acyn4'))
        return { ok: true, json: async () => NWPS_ACYN4 };
      return { ok: false, status: 404, json: async () => ({ code: 5 }) };
    }
    if (text.includes('product=water_level')) {
      return { ok: true, json: async () => coopsRange(range) };
    }
    if (text.includes('product=predictions')) {
      return { ok: true, json: async () => coopsPreds(nextHigh) };
    }
    if (text.includes('coast.noaa.gov')) {
      const png = text.includes('slr_0ft') ? BASE_PNG : LEVEL_PNG;
      return {
        ok: true,
        arrayBuffer: async () =>
          png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      };
    }
    throw new Error(`unexpected fetch ${text}`);
  };
  return { fetchImpl, calls };
}

test('roundLevel and serviceForLevel follow the NOAA half-foot ladder', () => {
  assert.equal(roundLevel(0), 0);
  assert.equal(roundLevel(0.24), 0);
  assert.equal(roundLevel(1.55), 1.5);
  assert.equal(roundLevel(10.9), 10);
  assert.equal(serviceForLevel(0), 'slr_0ft');
  assert.equal(serviceForLevel(1), 'slr_1ft');
  assert.equal(serviceForLevel(1.5), 'slr_1_5ft');
  assert.equal(serviceForLevel(2.5), 'slr_2_5ft');
});

test('tileCenter puts the Cape May test tile inside the county box', () => {
  const [lat, lon] = tileCenter(11, 597, 782);
  assert.ok(lat > 38.85 && lat < 39.75, `lat ${lat}`);
  assert.ok(lon > -75.45 && lon < -74.3, `lon ${lon}`);
});

test('levelForTile is 0 when no forecast peak reaches the minor stage', () => {
  const gauges = [
    {
      lat: 38.9683,
      lon: -74.96,
      mhhw_ft: 5.45,
      minor_stage_ft: 6.2,
      forecast_ft: 4.779,
    },
    {
      lat: 39.3567,
      lon: -74.4183,
      mhhw_ft: 4.6,
      minor_stage_ft: 6,
      forecast_ft: 4.8,
    },
  ];
  assert.equal(levelForTile(gauges, 11, 597, 782), 0);
});

test('levelForTile uses the nearest flooding gauge, rounded to a half foot', () => {
  const gauges = [
    {
      lat: 38.9683,
      lon: -74.96,
      mhhw_ft: 5.45,
      minor_stage_ft: 6.2,
      forecast_ft: 7.0,
    },
    {
      lat: 39.3567,
      lon: -74.4183,
      mhhw_ft: 4.6,
      minor_stage_ft: 6,
      forecast_ft: 4.8,
    },
  ];
  assert.equal(levelForTile(gauges, 11, 597, 782), 1.5);
  assert.equal(levelForTile(gauges, 11, 0, 0), 0);
});

test('buildFloodTile returns a transparent tile and never touches NOAA when dry', async () => {
  const { fetchImpl, calls } = stubFetch({ nextHigh: 4.779 });
  const png = await buildFloodTile({
    fetchImpl,
    now: () => NOW,
    z: 11,
    x: 597,
    y: 782,
  });
  const decoded = decodePng(png);
  assert.ok(decoded.data.every((v, i) => i % 4 !== 3 || v === 0));
  assert.equal(
    calls.some((url) => url.includes('coast.noaa.gov')),
    false,
  );
});

test('buildFloodTile diffs the NOAA level tile against the 0 ft tile', async () => {
  const { fetchImpl, calls } = stubFetch({ nextHigh: 7.0 });
  const png = await buildFloodTile({
    fetchImpl,
    now: () => NOW,
    z: 11,
    x: 597,
    y: 782,
  });
  const noaaCalls = calls.filter((url) => url.includes('coast.noaa.gov'));
  assert.equal(noaaCalls.length, 2);
  // ArcGIS tile order is z/y/x, not the route's z/x/y.
  assert.ok(
    noaaCalls.some(
      (url) => url.includes('/tile/11/782/597') && url.includes('slr_1_5ft'),
    ),
  );
  assert.ok(noaaCalls.some((url) => url.includes('slr_0ft')));
  const decoded = decodePng(png);
  assert.deepEqual(
    Array.from(decoded.data),
    [
      37, 99, 235, 200, 0, 0, 0, 0, 0, 0, 0, 0, 37, 99, 235, 200, 0, 0, 0, 0,
      37, 99, 235, 200, 37, 99, 235, 200, 37, 99, 235, 200,
    ],
  );
});

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
  };
}

test('floodTilesProxy serves PNG, 404s bad paths, and never errors a tile', async () => {
  const { fetchImpl } = stubFetch({ nextHigh: 7.0 });
  const plugin = floodTilesProxy({ fetchImpl, now: () => NOW });
  let handler;
  plugin.configureServer({
    middlewares: { use: (path, fn) => (handler = fn) },
  });
  const res = fakeRes();
  await handler({ method: 'GET', url: '/11/597/782.png', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.equal(decodePng(res.body).width, 4);
  const bad = fakeRes();
  await handler({ method: 'GET', url: '/11/597.png', headers: {} }, bad);
  assert.equal(bad.statusCode, 404);
  const out = fakeRes();
  await handler({ method: 'GET', url: '/9/597/782.png', headers: {} }, out);
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body, emptyTilePng());
});
