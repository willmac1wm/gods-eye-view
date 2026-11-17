import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsgsGaugesSource } from './source.js';

const features = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411000',
        parameter_code: '00065',
        time: '2026-11-16T17:00:00+00:00',
        value: '3.76',
        unit_of_measure: 'ft',
        approval_status: 'Provisional',
        qualifier: null,
      },
    },
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411000',
        parameter_code: '00060',
        time: '2026-11-16T17:00:00+00:00',
        value: '67.6',
        unit_of_measure: 'ft3/s',
        approval_status: 'Provisional',
        qualifier: null,
      },
    },
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411300',
        parameter_code: '00065',
        time: '2026-11-16T16:20:00+00:00',
        value: '3.94',
        unit_of_measure: 'ft',
        approval_status: 'Provisional',
        qualifier: null,
      },
    },
  ],
};

function stubFetch(payload, status = 200) {
  return async (url) => {
    assert.equal(url, '/api/gauges');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test('snapshot carries both gauges with per-gauge staleness', async () => {
  const source = createUsgsGaugesSource({
    fetchImpl: stubFetch({
      fetchedAt: 1,
      stale: false,
      ttlMs: 900000,
      features,
    }),
    now: () => Date.parse('2026-11-16T17:30:00Z'),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.gauges.length, 2);
  const folsom = snapshot.gauges.find(
    (gauge) => gauge.siteId === '01411000',
  );
  assert.equal(folsom.gageHeight.value, 3.76);
  assert.equal(folsom.stale, false);
  const tuckahoe = snapshot.gauges.find(
    (gauge) => gauge.siteId === '01411300',
  );
  assert.equal(tuckahoe.gageHeight.value, 3.94);
  assert.equal(tuckahoe.stale, false);
  assert.equal(snapshot.stale, false);
});

test('a reading older than two hours is stale, never current', async () => {
  const source = createUsgsGaugesSource({
    fetchImpl: stubFetch({ fetchedAt: 1, stale: false, features }),
    now: () => Date.parse('2026-11-16T20:00:00Z'),
  });
  const snapshot = await source.getSnapshot({});
  assert.ok(snapshot.gauges.every((gauge) => gauge.stale === true));
});

test('a malformed proxy payload throws instead of half-rendering', async () => {
  const source = createUsgsGaugesSource({
    fetchImpl: stubFetch({ features: { features: 'nope' } }),
  });
  await assert.rejects(() => source.getSnapshot({}), /Malformed/);
});

test('a proxy 502 throws with the status', async () => {
  const source = createUsgsGaugesSource({
    fetchImpl: stubFetch({ error: 'USGS fetch failed' }, 502),
  });
  await assert.rejects(() => source.getSnapshot({}), /Gauges HTTP 502/);
});
