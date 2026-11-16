import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurveillanceSource, buildOverpassQuery } from './source.js';

const box = { south: 38.9, west: -75.15, north: 39.35, east: -74.55 };

// Live county payload shape, verified against Overpass 2026-11-16.
const elements = [
  {
    type: 'node',
    id: 13116656753,
    lat: 38.9326358,
    lon: -74.9230437,
    tags: {
      man_made: 'surveillance',
      'surveillance:type': 'camera',
    },
  },
  {
    type: 'node',
    id: 14077264754,
    lat: 39.0346601,
    lon: -74.7705174,
    tags: {
      'camera:direction': '300',
      'camera:mount': 'pole',
      'camera:type': 'fixed',
      man_made: 'surveillance',
      surveillance: 'public,_outdoor',
      'surveillance:type': 'camera',
      'surveillance:zone': 'parking',
    },
  },
  {
    type: 'node',
    id: 13179164589,
    lat: 39.0115979,
    lon: -74.8851915,
    tags: {
      'camera:type': 'fixed',
      man_made: 'surveillance',
      manufacturer: 'Flock Safety',
      'surveillance:type': 'ALPR',
    },
  },
];

function stubFetch(payload, { status = 200, cache = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name) =>
          name.toLowerCase() === 'x-overpass-cache' ? cache : null,
      },
      json: async () => payload,
    };
  };
  return { fetchImpl, calls };
}

test('snapshot carries both county cameras and drops the ALPR node', async () => {
  const { fetchImpl, calls } = stubFetch({ elements });
  const source = createSurveillanceSource({ fetchImpl });
  const snapshot = await source.fetch(box, {});
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(
    snapshot.records.map((record) => record.id),
    ['surv:13116656753', 'surv:14077264754'],
  );
  assert.equal(snapshot.records[1].directionDeg, 300);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.saturated, false);
  assert.deepEqual(snapshot.coverage, box);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/overpass');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(
    new URLSearchParams(calls[0].options.body).get('data'),
    buildOverpassQuery(box.south, box.west, box.north, box.east),
  );
});

test('a stale proxy cache is surfaced, never hidden', async () => {
  const { fetchImpl } = stubFetch({ elements }, { cache: 'STALE' });
  const source = createSurveillanceSource({ fetchImpl });
  const snapshot = await source.fetch(box, {});
  assert.equal(snapshot.stale, true);
});

test('the source rejects invalid and unbounded queries before fetching', async () => {
  let calls = 0;
  const source = createSurveillanceSource({
    fetchImpl() {
      calls++;
    },
  });
  for (const bad of [
    null,
    { ...box, west: '0);out;' },
    { ...box, north: 90 },
    { ...box, east: -76 },
    { ...box, south: NaN },
  ]) {
    await assert.rejects(source.fetch(bad, {}), /bounded city viewport/);
  }
  assert.equal(calls, 0);
});

test('a proxy 429 reports rate-limited; a 502 reports unavailable', async () => {
  const rateLimited = stubFetch({ error: 'slow down' }, { status: 429 });
  await assert.rejects(
    () =>
      createSurveillanceSource({ fetchImpl: rateLimited.fetchImpl }).fetch(
        box,
        {},
      ),
    /Overpass rate-limited/,
  );
  const down = stubFetch({ error: 'bad gateway' }, { status: 502 });
  await assert.rejects(
    () =>
      createSurveillanceSource({ fetchImpl: down.fetchImpl }).fetch(box, {}),
    /Overpass temporarily unavailable/,
  );
});

test('a malformed proxy payload throws instead of half-rendering', async () => {
  const { fetchImpl } = stubFetch({ elements: 'nope' });
  const source = createSurveillanceSource({ fetchImpl });
  await assert.rejects(() => source.fetch(box, {}), /incomplete camera/);
  const remarked = stubFetch({ elements: [], remark: 'runtime error' });
  const remarkedSource = createSurveillanceSource({
    fetchImpl: remarked.fetchImpl,
  });
  await assert.rejects(
    () => remarkedSource.fetch(box, {}),
    /incomplete camera/,
  );
});
