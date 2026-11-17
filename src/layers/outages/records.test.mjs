import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOutageCounty,
  normalizeOutageAreas,
  normalizeOutageAlerts,
  hasMajorEvent,
  severityForPct,
} from './records.js';

const countyPayload = {
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
    trend: {
      direction: 'steady',
      duration_min: 90,
      peak_out: 2275,
      normalcy: 'routine',
      vs_record_pct: 0,
    },
  },
  meta: {
    live: {
      status: 'ok',
      last_poll_ts: '2026-11-16T15:15:16.710Z',
      behind_min: 5,
    },
  },
};

const areasPayload = {
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
      pct_out: 0.38611792495684566,
    },
  ],
  as_of: '2026-11-16T17:00:41.427Z',
};

const alertsPayload = {
  data: {
    fips: '34009',
    thresholds: { min_customers: null, min_pct: null, major_event_pct: 10 },
    county: {
      customers_out: 99,
      pct_out: 0.1764800256698219,
      above_threshold: false,
    },
    utilities: [
      {
        utility_key: '963',
        name: 'Atlantic City Electric Co',
        connector_status: 'county',
        customers_out: 99,
        customers_served: 113764,
        pct_out: 0.08702225660138532,
        above_threshold: false,
        major_event: false,
        visible: true,
      },
    ],
    areas_above_threshold: [],
    as_of: '2026-11-16T17:00:41.427Z',
  },
};

test('county payload normalizes with trend and live status', () => {
  const county = normalizeOutageCounty(countyPayload);
  assert.equal(county.fips, '34009');
  assert.equal(county.customersOut, 99);
  assert.equal(county.customersTracked, 113764);
  assert.equal(county.pct, 0.09);
  assert.equal(county.incidentCount, 4);
  assert.equal(county.utilities[0].name, 'Atlantic City Electric Co');
  assert.equal(county.utilities[0].customersOut, 99);
  assert.equal(county.trend.direction, 'steady');
  assert.equal(county.trend.peakOut, 2275);
  assert.equal(county.liveStatus, 'ok');
  assert.ok(Number.isFinite(county.asOfMs));
});

test('county payload rejects malformed counts and error envelopes', () => {
  assert.equal(normalizeOutageCounty(null), null);
  assert.equal(normalizeOutageCounty({ error: 'boom' }), null);
  assert.equal(
    normalizeOutageCounty({
      data: { ...countyPayload.data, customers_out: 'many' },
    }),
    null,
  );
  assert.equal(
    normalizeOutageCounty({
      data: { ...countyPayload.data, utilities: [{ name: 'ACE' }] },
    }),
    null,
  );
});

test('areas payload normalizes bbox center and pct', () => {
  const [area] = normalizeOutageAreas(areasPayload);
  assert.equal(area.name, 'OCEAN CITY');
  assert.equal(area.customersOut, 85);
  assert.equal(area.customersServed, 22014);
  assert.ok(Math.abs(area.lat - 39.25847332745) < 1e-9);
  assert.ok(Math.abs(area.lon - -74.5977777139) < 1e-9);
  assert.ok(Math.abs(area.pctOut - 0.38611792495684566) < 1e-12);
  assert.equal(area.etrMs, Date.parse('2026-11-16T19:00:00.000Z'));
});

test('areas payload: an empty list is a valid quiet county', () => {
  assert.deepEqual(normalizeOutageAreas({ data: [], as_of: null }), []);
});

test('areas payload rejects a flipped bbox and a masked count stays unknown', () => {
  const flipped = {
    data: [
      { ...areasPayload.data[0], bbox: [-74.54, 39.31, -74.65, 39.2] },
    ],
  };
  assert.equal(normalizeOutageAreas(flipped), null);
  const masked = {
    data: [{ ...areasPayload.data[0], customers_out: '<10' }],
  };
  const [area] = normalizeOutageAreas(masked);
  assert.equal(area.customersOut, null);
});

test('alerts payload normalizes the NJ 10% major-event line', () => {
  const alerts = normalizeOutageAlerts(alertsPayload);
  assert.equal(alerts.majorEventPct, 10);
  assert.equal(alerts.county.customersOut, 99);
  assert.equal(alerts.utilities[0].connectorStatus, 'county');
  assert.equal(alerts.utilities[0].majorEvent, false);
  assert.equal(alerts.utilities[0].clear, false);
  assert.equal(hasMajorEvent(alerts), false);
  const major = normalizeOutageAlerts({
    data: {
      ...alertsPayload.data,
      utilities: [
        { ...alertsPayload.data.utilities[0], major_event: true },
      ],
    },
  });
  assert.equal(hasMajorEvent(major), true);
});

test('a utility is only "clear" when its connector is live and it has zero out', () => {
  const clear = normalizeOutageAlerts({
    data: {
      ...alertsPayload.data,
      utilities: [
        { ...alertsPayload.data.utilities[0], customers_out: 0 },
      ],
    },
  });
  assert.equal(clear.utilities[0].clear, true);
  const down = normalizeOutageAlerts({
    data: {
      ...alertsPayload.data,
      utilities: [
        {
          ...alertsPayload.data.utilities[0],
          customers_out: 0,
          connector_status: 'down',
        },
      ],
    },
  });
  assert.equal(down.utilities[0].clear, false);
});

test('severity ranks follow the pct thresholds', () => {
  assert.equal(severityForPct(0), 'none');
  assert.equal(severityForPct(null), 'none');
  assert.equal(severityForPct(0.09), 'watch');
  assert.equal(severityForPct(1), 'minor');
  assert.equal(severityForPct(5), 'moderate');
  assert.equal(severityForPct(10), 'major');
});
