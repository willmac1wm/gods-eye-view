import assert from 'node:assert/strict';
import test from 'node:test';
import { createMassOutageSource } from './source.js';

const county = {
  data: {
    fips: '34009',
    customers_out: 99,
    customers_tracked: 113764,
    pct: 0.09,
    incident_count: 4,
    utilities: [
      {
        id: '963',
        etr: '2026-11-16T19:00:00Z',
        name: 'Atlantic City Electric Co',
        customers_out: 99,
      },
    ],
    worst_etr: '2026-11-16T19:00:00.000Z',
    updated_at: '2026-11-16T16:55:24.272Z',
    as_of: '2026-11-16T16:55:24.272Z',
    trend: null,
  },
  meta: { live: { status: 'ok' } },
};

const areas = {
  data: [
    {
      utility_key: '963',
      utility_name: 'Atlantic City Electric Co',
      area_type: 'muni',
      name: 'OCEAN CITY',
      customers_served: 22014,
      customers_out: 85,
      masked_outages: 0,
      incident_count: 1,
      etr: '2026-11-16T19:00:00.000Z',
      bbox: [-74.6552594577, 39.2068500528, -74.5402959701, 39.3100966021],
      as_of: '2026-11-16T17:00:41.427Z',
      pct_out: 0.386,
    },
  ],
};

const alerts = {
  data: {
    fips: '34009',
    thresholds: { major_event_pct: 10 },
    county: { customers_out: 99, pct_out: 0.17, above_threshold: false },
    utilities: [
      {
        utility_key: '963',
        name: 'Atlantic City Electric Co',
        connector_status: 'county',
        customers_out: 99,
        customers_served: 113764,
        pct_out: 0.08,
        above_threshold: false,
        major_event: false,
        visible: true,
      },
    ],
    areas_above_threshold: [],
    as_of: '2026-11-16T17:00:41.427Z',
  },
};

function stubFetch(payload, status = 200) {
  return async (url) => {
    assert.equal(url, '/api/outages');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test('snapshot combines county, areas and alerts from one proxy call', async () => {
  const source = createMassOutageSource({
    fetchImpl: stubFetch({
      fetchedAt: 1,
      stale: false,
      ttlMs: 300000,
      county,
      areas,
      alerts,
    }),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.county.customersOut, 99);
  assert.equal(snapshot.areas.length, 1);
  assert.equal(snapshot.areas[0].name, 'OCEAN CITY');
  assert.equal(snapshot.alerts.majorEventPct, 10);
  assert.equal(snapshot.majorEvent, false);
  assert.equal(snapshot.stale, false);
});

test('an empty areas list is a quiet county, not an error', async () => {
  const source = createMassOutageSource({
    fetchImpl: stubFetch({ county, areas: { data: [] }, alerts }),
  });
  const snapshot = await source.getSnapshot({});
  assert.deepEqual(snapshot.areas, []);
  assert.equal(snapshot.county.customersOut, 99);
});

test('a malformed proxy payload throws instead of half-rendering', async () => {
  const source = createMassOutageSource({
    fetchImpl: stubFetch({ county, areas: { data: 'nope' }, alerts }),
  });
  await assert.rejects(() => source.getSnapshot({}), /Malformed/);
});

test('a proxy 502 throws with the status', async () => {
  const source = createMassOutageSource({
    fetchImpl: stubFetch({ error: 'MassOutage fetch failed' }, 502),
  });
  await assert.rejects(() => source.getSnapshot({}), /Outages HTTP 502/);
});

test('an aborted snapshot throws instead of returning stale data', async () => {
  const source = createMassOutageSource({ fetchImpl: stubFetch({}) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (error) => error.name === 'AbortError' || /abort/i.test(error.message),
  );
});
