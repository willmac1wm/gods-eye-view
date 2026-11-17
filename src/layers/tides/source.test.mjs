import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCoopsTidesSource,
  FALLBACK_THRESHOLDS_MLLW,
  TIDES_GAUGES,
} from './source.js';

// Verbatim live payloads, NOAA CO-OPS, 2026-11-15 ~21:12 EST.
function observedPayload(stationId, points) {
  const meta = {
    8536110: { id: '8536110', name: 'Cape May', lat: '38.9683', lon: '-74.96' },
    8534720: {
      id: '8534720',
      name: 'Atlantic City',
      lat: '39.3567',
      lon: '-74.4181',
    },
  }[stationId];
  return { metadata: meta, data: points };
}

const CAPE_MAY_OBSERVED = observedPayload('8536110', [
  { t: '2026-11-15 20:00', v: '1.864' },
  { t: '2026-11-15 21:00', v: '2.405' },
  { t: '2026-11-15 21:12', v: '2.536', s: '0.049', f: '0,0,0,0', q: 'p' },
]);
const CAPE_MAY_PREDICTED = {
  predictions: [
    { t: '2026-11-15 20:00', v: '1.251' },
    { t: '2026-11-15 21:00', v: '1.816' },
    { t: '2026-11-15 21:12', v: '1.949' },
  ],
};
const ATLANTIC_CITY_OBSERVED = observedPayload('8534720', [
  { t: '2026-11-15 20:00', v: '2.100' },
  { t: '2026-11-15 21:00', v: '2.550' },
  { t: '2026-11-15 21:12', v: '2.673', s: '0.098', f: '1,0,0,0', q: 'p' },
]);
const ATLANTIC_CITY_PREDICTED = {
  predictions: [
    { t: '2026-11-15 20:00', v: '1.900' },
    { t: '2026-11-15 21:00', v: '2.300' },
    { t: '2026-11-15 21:12', v: '2.100' },
  ],
};

const FLOODLEVELS = {
  8536110: {
    nos_minor: 9.72,
    nos_moderate: 10.66,
    nos_major: 11.92,
    nws_minor: 9.12,
    nws_moderate: 10.12,
    nws_major: 11.12,
    action: null,
  },
  8534720: {
    nos_minor: 11.38,
    nos_moderate: 12.32,
    nos_major: 13.58,
    nws_minor: 10.96,
    nws_moderate: 11.96,
    nws_major: 12.96,
    action: null,
  },
};
const DATUMS = {
  8536110: {
    units: 'feet',
    datums: [
      { name: 'MHHW', value: 7.87 },
      { name: 'MLLW', value: 2.42 },
    ],
  },
  8534720: {
    units: 'feet',
    datums: [
      { name: 'MHHW', value: 9.56 },
      { name: 'MLLW', value: 4.96 },
    ],
  },
};

/** Route stubbed fetches by URL; record every call. */
function stubFetch({ observed = {}, predicted = {}, floodlevels = FLOODLEVELS, datums = DATUMS, fail = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    const parsed = new URL(url);
    const station = parsed.searchParams.get('station');
    if (url.includes('/floodlevels.json')) {
      const id = url.split('/stations/')[1].split('/')[0];
      if (fail[`floodlevels:${id}`]) return fail[`floodlevels:${id}`]();
      return Response.json(floodlevels[id]);
    }
    if (url.includes('/datums.json')) {
      const id = url.split('/stations/')[1].split('/')[0];
      if (fail[`datums:${id}`]) return fail[`datums:${id}`]();
      return Response.json(datums[id]);
    }
    const product = parsed.searchParams.get('product');
    if (fail[`${product}:${station}`]) return fail[`${product}:${station}`]();
    if (product === 'water_level')
      return Response.json(observed[station] ?? CAPE_MAY_OBSERVED);
    if (product === 'predictions')
      return Response.json(predicted[station] ?? CAPE_MAY_PREDICTED);
    throw new Error(`unexpected CO-OPS request: ${url}`);
  };
  return { calls, fetchImpl };
}

const OBSERVED = {
  8536110: CAPE_MAY_OBSERVED,
  8534720: ATLANTIC_CITY_OBSERVED,
};
const PREDICTED = {
  8536110: CAPE_MAY_PREDICTED,
  8534720: ATLANTIC_CITY_PREDICTED,
};

test('happy path returns both gauges with live-converted thresholds and residual', async () => {
  const { calls, fetchImpl } = stubFetch({ observed: OBSERVED, predicted: PREDICTED });
  const source = createCoopsTidesSource({ fetchImpl });
  const rows = await source.getSnapshot();
  assert.equal(rows.length, 2);
  const capeMay = rows.find((row) => row.stationId === '8536110');
  assert.equal(capeMay.observedFtMllw, 2.536);
  assert.equal(capeMay.observedTime, '2026-11-15 21:12');
  assert.equal(capeMay.predictedFtMllw, 1.949);
  assert.equal(capeMay.residualFt, 0.587);
  assert.equal(capeMay.floodStage, 'none');
  assert.equal(capeMay.trend, 'rising');
  // MDAPI flood levels are feet above station datum; the source converts
  // them to ft MLLW with the live MLLW offset (9.12 - 2.42 = 6.70).
  assert.deepEqual(capeMay.thresholdsMllw, { minor: 6.7, moderate: 7.7, major: 8.7 });
  assert.deepEqual(capeMay.nosThresholdsMllw, { minor: 7.3, moderate: 8.24, major: 9.5 });
  const atlanticCity = rows.find((row) => row.stationId === '8534720');
  assert.equal(atlanticCity.observedFtMllw, 2.673);
  assert.equal(atlanticCity.residualFt, 0.573);
  assert.deepEqual(atlanticCity.thresholdsMllw, { minor: 6, moderate: 7, major: 8 });
  assert.deepEqual(atlanticCity.nosThresholdsMllw, { minor: 6.42, moderate: 7.36, major: 8.62 });

  // The datagetter requests carry the CO-OPS application identifier and the
  // 6-minute prediction interval; no key is ever sent.
  const water = calls.find((url) => url.includes('product=water_level') && url.includes('station=8536110'));
  assert.match(water, /datum=MLLW/);
  assert.match(water, /units=english/);
  assert.match(water, /time_zone=lst_ldt/);
  assert.match(water, /application=cape-dispatch/);
  assert.match(water, /format=json/);
  const predictions = calls.find((url) => url.includes('product=predictions'));
  assert.match(predictions, /interval=6/);
  assert.equal(calls.filter((url) => url.includes('mdapi')).length, 4);
});

test('one failing gauge does not sink the other; both failing throws', async (t) => {
  const http400 = () =>
    Response.json(
      { error: { message: 'There is no MLLW for the station: 9999999' } },
      { status: 400 },
    );
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const { fetchImpl } = stubFetch({
    observed: OBSERVED,
    predicted: PREDICTED,
    fail: { 'water_level:8536110': async () => http400() },
  });
  const rows = await createCoopsTidesSource({ fetchImpl }).getSnapshot();
  assert.deepEqual(
    rows.map((row) => row.stationId),
    ['8534720'],
  );
  assert.ok(
    warnings.some((args) =>
      args.some((arg) => arg instanceof Error && /CO-OPS HTTP 400/.test(arg.message)),
    ),
    'the HTTP 400 is reported with its status',
  );

  const { fetchImpl: failing } = stubFetch({
    observed: OBSERVED,
    predicted: PREDICTED,
    fail: {
      'water_level:8536110': async () => http400(),
      'water_level:8534720': async () => http400(),
    },
  });
  await assert.rejects(
    createCoopsTidesSource({ fetchImpl: failing }).getSnapshot(),
    /No tide gauge returned usable data/,
  );
});

test('malformed JSON drops the gauge; both dropping throws', async () => {
  const badJson = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });
  const { fetchImpl } = stubFetch({
    observed: OBSERVED,
    predicted: PREDICTED,
    fail: { 'predictions:8536110': badJson },
  });
  const rows = await createCoopsTidesSource({ fetchImpl }).getSnapshot();
  assert.deepEqual(
    rows.map((row) => row.stationId),
    ['8534720'],
  );
  const { fetchImpl: allBad } = stubFetch({
    observed: OBSERVED,
    predicted: PREDICTED,
    fail: {
      'predictions:8536110': badJson,
      'predictions:8534720': badJson,
    },
  });
  await assert.rejects(
    createCoopsTidesSource({ fetchImpl: allBad }).getSnapshot(),
    /No tide gauge returned usable data/,
  );
});

test('bad floodlevels fall back to the pinned thresholds and are cached', async () => {
  // MDAPI answers 404 with an HTML error page for an unknown station, and a
  // malformed floodlevels payload parses to nothing: either way the layer
  // keeps its pinned thresholds instead of losing the flood stage.
  const html404 = async () => ({
    ok: false,
    status: 404,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });
  const { calls, fetchImpl } = stubFetch({
    observed: OBSERVED,
    predicted: PREDICTED,
    fail: {
      'floodlevels:8536110': html404,
      'floodlevels:8534720': async () => Response.json({ nos_minor: 1 }),
    },
  });
  const source = createCoopsTidesSource({ fetchImpl });
  const first = await source.getSnapshot();
  assert.deepEqual(
    first.find((row) => row.stationId === '8536110').thresholdsMllw,
    FALLBACK_THRESHOLDS_MLLW[8536110].nws,
  );
  assert.deepEqual(
    first.find((row) => row.stationId === '8534720').thresholdsMllw,
    FALLBACK_THRESHOLDS_MLLW[8534720].nws,
  );
  const mdapiCalls = calls.filter((url) => url.includes('mdapi')).length;
  assert.equal(mdapiCalls, 4, 'one floodlevels + one datums fetch per gauge');
  await source.getSnapshot();
  assert.equal(
    calls.filter((url) => url.includes('mdapi')).length,
    mdapiCalls,
    'thresholds are fetched once per source instance and cached',
  );
  assert.equal(
    calls.filter((url) => url.includes('datagetter')).length,
    8,
    'each poll still refetches both gauges',
  );
});

test('an aborted signal rejects before and during the fetch', async () => {
  const aborted = new AbortController();
  aborted.abort();
  const { fetchImpl } = stubFetch({ observed: OBSERVED, predicted: PREDICTED });
  await assert.rejects(
    createCoopsTidesSource({ fetchImpl }).getSnapshot({ signal: aborted.signal }),
    { name: 'AbortError' },
  );

  // Uncooperative transport: the fetch resolves only after the abort, and
  // the snapshot must still reject instead of publishing stale rows.
  const late = new AbortController();
  const hanging = createCoopsTidesSource({
    fetchImpl: async (url, { signal } = {}) => {
      // Resolve at once if the signal is already aborted: an abort listener
      // registered after the abort would never fire and the fetch would hang.
      if (signal?.aborted) return Response.json(CAPE_MAY_OBSERVED);
      await new Promise((resolve) => {
        signal?.addEventListener('abort', resolve, { once: true });
      });
      return Response.json(CAPE_MAY_OBSERVED);
    },
  });
  const pending = hanging.getSnapshot({ signal: late.signal });
  late.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('FALLBACK_THRESHOLDS_MLLW pins the verified MDAPI conversion', () => {
  assert.deepEqual(FALLBACK_THRESHOLDS_MLLW[8536110], {
    nws: { minor: 6.7, moderate: 7.7, major: 8.7 },
    nos: { minor: 7.3, moderate: 8.24, major: 9.5 },
  });
  assert.deepEqual(FALLBACK_THRESHOLDS_MLLW[8534720], {
    nws: { minor: 6.0, moderate: 7.0, major: 8.0 },
    nos: { minor: 6.42, moderate: 7.36, major: 8.62 },
  });
  assert.equal(TIDES_GAUGES.length, 2);
  assert.deepEqual(
    TIDES_GAUGES.map((gauge) => gauge.id),
    ['8536110', '8534720'],
  );
});
