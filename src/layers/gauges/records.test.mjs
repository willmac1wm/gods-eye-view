import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeUsgsLatestFeatures,
  gaugeIsStale,
  GAUGES_STALE_AFTER_MS,
} from './records.js';

// Verbatim-shaped Water Data API v1 latest-continuous payload, live 2026-11-16.
const livePayload = {
  type: 'FeatureCollection',
  features: [
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
        statistic_id: '00011',
      },
    },
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411300',
        parameter_code: '00065',
        time: '2026-11-16T16:20:00+00:00',
        value: null,
        unit_of_measure: 'ft',
        approval_status: 'Provisional',
        qualifier: ['EQUIP'],
        statistic_id: '00011',
      },
    },
    {
      type: 'Feature',
      properties: {
        monitoring_location_id: 'USGS-01411300',
        parameter_code: '00060',
        time: '2026-11-16T16:05:00+00:00',
        value: '17.4',
        unit_of_measure: 'ft3/s',
        approval_status: 'Provisional',
        qualifier: null,
        statistic_id: '00011',
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
        statistic_id: '00011',
      },
    },
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
        statistic_id: '00011',
      },
    },
  ],
};

test('live payload normalizes both gauges with both parameters', () => {
  const { gauges } = normalizeUsgsLatestFeatures(livePayload);
  assert.equal(gauges.length, 2);
  const tuckahoe = gauges.find((gauge) => gauge.siteId === '01411300');
  assert.equal(tuckahoe.name, 'Tuckahoe River at Head of River, NJ');
  assert.equal(tuckahoe.gageHeight.value, 3.94);
  assert.equal(tuckahoe.gageHeight.unit, 'ft');
  assert.equal(tuckahoe.gageHeight.approvalStatus, 'Provisional');
  assert.equal(tuckahoe.discharge.value, 17.4);
  assert.equal(tuckahoe.discharge.unit, 'ft3/s');
  assert.equal(
    tuckahoe.asOfMs,
    Date.parse('2026-11-16T16:20:00+00:00'),
  );
  const folsom = gauges.find((gauge) => gauge.siteId === '01411000');
  assert.equal(folsom.gageHeight.value, 3.76);
  assert.equal(folsom.discharge.value, 67.6);
  assert.ok(Math.abs(folsom.lat - 39.5947) < 1e-9);
  assert.ok(Math.abs(folsom.lon - -74.8517) < 1e-9);
});

test('the EQUIP-qualified null duplicate never wins over the clean reading', () => {
  const equipOnly = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          monitoring_location_id: 'USGS-01411300',
          parameter_code: '00065',
          time: '2026-11-16T16:20:00+00:00',
          value: null,
          unit_of_measure: 'ft',
          approval_status: 'Provisional',
          qualifier: ['EQUIP'],
        },
      },
    ],
  };
  // EQUIP-only: the gauge has no valid gage-height reading at all.
  assert.equal(normalizeUsgsLatestFeatures(equipOnly), null);
});

test('a gauge with only one parameter still reports', () => {
  const partial = {
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
    ],
  };
  const { gauges } = normalizeUsgsLatestFeatures(partial);
  assert.equal(gauges.length, 1);
  assert.equal(gauges[0].gageHeight.value, 3.76);
  assert.equal(gauges[0].discharge, null);
});

test('untracked sites are ignored; malformed payloads reject wholesale', () => {
  const extra = {
    type: 'FeatureCollection',
    features: [
      ...livePayload.features,
      {
        type: 'Feature',
        properties: {
          monitoring_location_id: 'USGS-01411315',
          parameter_code: '00065',
          time: '2026-11-16T17:00:00+00:00',
          value: '1.5',
          unit_of_measure: 'ft',
          approval_status: 'Provisional',
          qualifier: null,
        },
      },
    ],
  };
  const { gauges } = normalizeUsgsLatestFeatures(extra);
  assert.equal(gauges.length, 2);
  assert.equal(normalizeUsgsLatestFeatures(null), null);
  assert.equal(normalizeUsgsLatestFeatures({}), null);
  assert.equal(
    normalizeUsgsLatestFeatures({ features: 'nope' }),
    null,
  );
  assert.equal(
    normalizeUsgsLatestFeatures({ features: [] }),
    null,
  );
});

test('stale is older than two hours', () => {
  assert.equal(GAUGES_STALE_AFTER_MS, 2 * 60 * 60_000);
  const now = Date.parse('2026-11-16T18:00:00Z');
  assert.equal(
    gaugeIsStale(Date.parse('2026-11-16T17:00:00Z'), now),
    false,
  );
  assert.equal(
    gaugeIsStale(Date.parse('2026-11-16T15:59:59Z'), now),
    true,
  );
  assert.equal(gaugeIsStale(null, now), true);
});
