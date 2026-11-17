import assert from 'node:assert/strict';
import test from 'node:test';
import { createSatelliteVerificationSource } from './source.js';

const TERRA_TILE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-16/GoogleMapsCompatible_Level9/9/195/149.jpg';

function tileResponse({ ok = true, status = 200, black = false } = {}) {
  return {
    ok,
    status,
    arrayBuffer: async () =>
      black
        ? new Uint8Array([1]).buffer
        : new Uint8Array([0]).buffer,
  };
}

// The provider route serves NORMALIZED products (it does the OData
// parsing); the source never sees raw OData. The row below is the
// normalized form of the real product returned live, 2026-11-17.
function odataResponse(products) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ products }),
  };
}

const LIVE_PRODUCT = {
  id: 'e4de0c65-5ae6-4034-999c-a688454733b7',
  name: 'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
  sensingDate: '2023-05-25',
  tile: 'T18SVJ',
  level: 'L1C',
  countyTile: true,
};

function makeSource({ fetchImpl, isBlackTile, now } = {}) {
  return createSatelliteVerificationSource({
    fetchImpl,
    isBlackTile: isBlackTile ?? ((buffer) => new Uint8Array(buffer)[0] === 1),
    now: now ?? (() => Date.parse('2026-11-17T14:00:00.000Z')),
  });
}

test('serves the requested date when Terra is live (2026-11-16, verified 200)', async () => {
  const seen = [];
  const source = makeSource({
    fetchImpl: async (url) => {
      seen.push(String(url));
      if (url.startsWith('https://gibs')) return tileResponse({ black: false });
      return odataResponse([LIVE_PRODUCT]);
    },
  });
  const snapshot = await source.getSnapshot({ date: '2026-11-16' });
  assert.equal(snapshot.date, '2026-11-16');
  assert.equal(snapshot.requestedDate, '2026-11-16');
  assert.equal(snapshot.source, 'MODIS_Terra');
  assert.equal(snapshot.tileStatus, 'live');
  assert.equal(snapshot.tileUrl, TERRA_TILE);
  assert.equal(snapshot.catalogueAvailable, true);
  assert.equal(snapshot.products.length, 1);
  assert.equal(snapshot.products[0].tile, 'T18SVJ');
  assert.ok(seen.some((u) => u.includes('/api/satellite-verification')));
});

test('a 200-but-black Terra tile on 2026-11-17 steps back to the 2026-11-16 scene', async () => {
  const source = makeSource({
    fetchImpl: async (url) => {
      const s = String(url);
      if (s.startsWith('https://gibs')) {
        if (s.includes('2026-11-17')) {
          // Terra: 200 but black (verified live); Aqua + NOAA20: 404.
          if (s.includes('MODIS_Terra')) return tileResponse({ black: true });
          return tileResponse({ ok: false, status: 404 });
        }
        return tileResponse({ black: false });
      }
      return odataResponse([LIVE_PRODUCT]);
    },
  });
  const snapshot = await source.getSnapshot({ date: '2026-11-17' });
  assert.equal(snapshot.date, '2026-11-16');
  assert.equal(snapshot.requestedDate, '2026-11-17');
  assert.equal(snapshot.source, 'MODIS_Terra');
  assert.equal(snapshot.tileStatus, 'nearest');
});

test('no imagery anywhere in 7 days reports none — never a neighbour', async () => {
  const source = makeSource({
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://gibs'))
        return tileResponse({ ok: false, status: 404 });
      return odataResponse([LIVE_PRODUCT]);
    },
  });
  const snapshot = await source.getSnapshot({ date: '2026-11-17' });
  assert.equal(snapshot.tileStatus, 'none');
  assert.equal(snapshot.date, null);
  assert.equal(snapshot.source, null);
  assert.equal(snapshot.tileUrl, null);
  assert.equal(snapshot.tileUrlTemplate, null);
  assert.equal(snapshot.products.length, 1);
});

test('an OData failure degrades to catalogue-unavailable, never a crash', async () => {
  const source = makeSource({
    fetchImpl: async (url) => {
      if (String(url).startsWith('https://gibs'))
        return tileResponse({ black: false });
      return { ok: false, status: 502, json: async () => ({}) };
    },
  });
  const snapshot = await source.getSnapshot({ date: '2026-11-16' });
  assert.equal(snapshot.tileStatus, 'live');
  assert.equal(snapshot.catalogueAvailable, false);
  assert.deepEqual(snapshot.products, []);
});

test('an aborted probe rejects with the abort error', async () => {
  const controller = new AbortController();
  controller.abort();
  const source = makeSource({
    fetchImpl: async (url, options) => {
      if (options?.signal?.aborted) throw controller.signal.reason;
      return tileResponse({ black: false });
    },
  });
  await assert.rejects(
    source.getSnapshot({ date: '2026-11-16', signal: controller.signal }),
    /aborted|Abort/,
  );
});

test('invalid dates reject before any fetch', async () => {
  let calls = 0;
  const source = makeSource({
    fetchImpl: async () => {
      calls += 1;
      return tileResponse({ black: false });
    },
  });
  await assert.rejects(source.getSnapshot({ date: 'yesterday' }), /Invalid date/);
  assert.equal(calls, 0);
});
