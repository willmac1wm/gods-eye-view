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

test('normalizeNwsAlerts returns [] for malformed payloads', () => {
  assert.deepEqual(normalizeNwsAlerts(null), []);
  assert.deepEqual(normalizeNwsAlerts({}), []);
  assert.deepEqual(normalizeNwsAlerts({ features: null }), []);
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
