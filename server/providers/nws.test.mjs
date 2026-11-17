import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNwsAlerts, nwsAlertsUrl, nwsProxy } from './nws.js';

test('nwsAlertsUrl queries the Cape May County zones', () => {
  assert.equal(
    nwsAlertsUrl(),
    'https://api.weather.gov/alerts/active?zone=NJZ023,NJZ024',
  );
});

test('normalizeNwsAlerts keeps the mapNws shape and GeoJSON geometry', () => {
  const alerts = normalizeNwsAlerts({
    features: [
      {
        id: 'f1',
        geometry: {
          type: 'Polygon',
          coordinates: [[[-74.9, 39.0], [-74.8, 39.0], [-74.8, 39.1], [-74.9, 39.0]]],
        },
        properties: {
          id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
          event: 'Coastal Flood Warning',
          headline: 'Coastal Flood Warning issued November 15',
          areaDesc: 'Cape May',
          severity: 'Severe',
        },
      },
      {
        id: 'f2',
        geometry: null,
        properties: {
          id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-2',
          event: 'Freeze Warning',
          headline: 'Freeze Warning issued November 15',
          areaDesc: 'Cape May',
          severity: 'Moderate',
        },
      },
      { properties: { event: '' } },
    ],
  });
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].event, 'Coastal Flood Warning');
  assert.equal(alerts[0].area, 'Cape May');
  assert.equal(alerts[0].geometry.type, 'Polygon');
  // Zone alerts with no geometry pass through as null; mapNws skips them.
  assert.equal(alerts[1].geometry, null);
  assert.equal(alerts[1].severity, 'Moderate');
});

test('normalizeNwsAlerts passes the plain-English card fields through (A9)', () => {
  const alerts = normalizeNwsAlerts({
    features: [
      {
        id: 'f1',
        geometry: null,
        properties: {
          id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
          event: 'Freeze Warning',
          headline: 'Freeze Warning issued November 14 at 12:56AM EST',
          areaDesc: 'Cape May',
          severity: 'Severe',
          instruction: 'Take steps now to protect tender plants from the cold.',
          description: 'Sub-freezing temperatures are expected.',
          effective: '2026-11-14T05:56:00+00:00',
          expires: '2026-11-14T14:00:00+00:00',
          onset: '2026-11-14T05:56:00+00:00',
          senderName: 'NWS Mount Holly NJ',
        },
      },
    ],
  });
  assert.equal(alerts.length, 1);
  assert.equal(
    alerts[0].instruction,
    'Take steps now to protect tender plants from the cold.',
  );
  assert.equal(alerts[0].description, 'Sub-freezing temperatures are expected.');
  assert.equal(alerts[0].effective, '2026-11-14T05:56:00+00:00');
  assert.equal(alerts[0].expires, '2026-11-14T14:00:00+00:00');
  assert.equal(alerts[0].onset, '2026-11-14T05:56:00+00:00');
  assert.equal(alerts[0].senderName, 'NWS Mount Holly NJ');
  // Older shapes without the card fields still normalize, with nulls.
  const thin = normalizeNwsAlerts({
    features: [{ properties: { event: 'Dense Fog Advisory' } }],
  });
  assert.equal(thin[0].instruction, null);
  assert.equal(thin[0].description, null);
  assert.equal(thin[0].senderName, null);
});

test('normalizeNwsAlerts returns [] for malformed payloads', () => {
  assert.deepEqual(normalizeNwsAlerts(null), []);
  assert.deepEqual(normalizeNwsAlerts({}), []);
  assert.deepEqual(normalizeNwsAlerts({ features: null }), []);
});

test('normalizeNwsAlerts drops features with no event property', () => {
  const alerts = normalizeNwsAlerts({
    features: [
      {
        id: 'urn:oid:2',
        geometry: null,
        properties: { headline: 'no event' },
      },
      {
        id: 'urn:oid:3',
        geometry: null,
        properties: {
          event: 'Freeze Warning',
          headline: 'Freeze Warning issued',
          areaDesc: 'Cape May',
          severity: 'Moderate',
        },
      },
    ],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].event, 'Freeze Warning');
});

function fakeRes() {
  const headers = new Map();
  const res = {
    statusCode: 200,
    headers,
    body: undefined,
    destroyed: false,
    writeHead(status, hdrs) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(hdrs || {})) headers.set(k, v);
    },
    end(body) {
      this.body = body;
    },
  };
  return res;
}

test('nwsProxy serves normalized alerts and caches the second request', async () => {
  let calls = 0;
  const payload = {
    features: [
      {
        id: 'f1',
        geometry: null,
        properties: {
          id: 'x',
          event: 'Gale Warning',
          headline: 'Gale Warning',
          areaDesc: 'Cape May',
          severity: 'Moderate',
        },
      },
    ],
  };
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      headers: { get: () => null },
      body: { cancel: async () => {} },
      text: async () => JSON.stringify(payload),
    };
  };
  // readResponseJsonCapped reads response.text(); the stub provides it.
  const plugin = nwsProxy({ fetchImpl });
  const server = { middlewares: { use: (path, fn) => (server.handler = fn) } };
  plugin.configureServer(server);
  const res1 = fakeRes();
  await server.handler({ method: 'GET', url: '/', headers: {} }, res1);
  assert.equal(res1.statusCode, 200);
  const body1 = JSON.parse(String(res1.body));
  assert.equal(body1.nws_alerts.length, 1);
  assert.equal(body1.nws_alerts[0].event, 'Gale Warning');
  assert.equal(body1.source, 'api.weather.gov');
  const res2 = fakeRes();
  await server.handler({ method: 'GET', url: '/', headers: {} }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(calls, 1);
});

test('nwsProxy answers 502 when the upstream is down and nothing is cached', async () => {
  const plugin = nwsProxy({
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });
  const server = { middlewares: { use: (path, fn) => (server.handler = fn) } };
  plugin.configureServer(server);
  const res = fakeRes();
  await server.handler({ method: 'GET', url: '/', headers: {} }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(String(res.body)).error, 'nws_unavailable');
});
