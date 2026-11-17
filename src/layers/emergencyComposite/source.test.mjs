import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmergencyCompositeSource } from './source.js';

const NOW = Date.parse('2026-11-17T12:00:00Z');

function layers({ nws, cad, plume } = {}) {
  return {
    nwsAlertCard: nws ?? {
      getAnalystRecords: () => [
        {
          id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
          event: 'Freeze Warning',
          severity: 'Severe',
          instruction: null,
          timeMs: NOW - 3600_000,
        },
      ],
      getStats: () => ({ lastUpdate: NOW - 60_000, count: 1 }),
    },
    capeCad: cad ?? {
      getStats: () => ({ lastUpdate: NOW - 60_000, count: 2 }),
    },
    plume: plume ?? {
      getStats: () => ({ lastUpdate: NOW - 60_000, count: 0, stale: false }),
    },
  };
}

function ipawsFetch(items) {
  return async (url, options) => {
    assert.match(url, /\/api\/alerts\/ipaws\?limit=10/);
    return {
      ok: true,
      json: async () => ({ count: items.length, delayedByH: 24, alerts: items }),
    };
  };
}

const IPAWS_ITEM = {
  incident_key: 'ipaws-1',
  title: 'Tornado Warning',
  severity: 'critical',
  last_seen: Math.floor(NOW / 1000) - 86_400,
};

test('assembles all four quadrants from the layer states + IPAWS', async () => {
  const source = createEmergencyCompositeSource({
    readLayers: () => layers(),
    fetchImpl: ipawsFetch([IPAWS_ITEM]),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.alerts.active, 1);
  assert.equal(snapshot.alerts.warnings, 1);
  assert.equal(snapshot.incidents.activeIncidents, 2);
  assert.equal(snapshot.hazmat.ipaws.available, true);
  assert.equal(snapshot.hazmat.ipaws.items.length, 1);
  assert.equal(snapshot.hazmat.ipaws.items[0].id, 'ipaws-1');
  assert.equal(snapshot.hazmat.plume.active, false);
  assert.equal(snapshot.evacuation.guidance, null);
});

test('a failed IPAWS fetch only takes down the IPAWS half', async () => {
  const source = createEmergencyCompositeSource({
    readLayers: () => layers(),
    fetchImpl: async () => {
      throw new Error('sidecar down');
    },
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.hazmat.ipaws.available, false);
  assert.equal(snapshot.hazmat.ipaws.items.length, 0);
  assert.equal(snapshot.alerts.active, 1);
  assert.equal(snapshot.incidents.activeIncidents, 2);
});

test('no layer states means unavailable quadrants, never a crash', async () => {
  const source = createEmergencyCompositeSource({
    readLayers: () => null,
    fetchImpl: ipawsFetch([]),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.alerts.available, false);
  assert.equal(snapshot.incidents.available, false);
  assert.equal(snapshot.hazmat.plume.available, false);
  assert.equal(snapshot.hazmat.ipaws.available, true);
  assert.equal(snapshot.hazmat.ipaws.items.length, 0);
});

test('a throwing layer reads as missing, never as zero', async () => {
  const source = createEmergencyCompositeSource({
    readLayers: () =>
      layers({
        cad: {
          getStats: () => {
            throw new Error('CAD layer broken');
          },
        },
      }),
    fetchImpl: ipawsFetch([]),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.incidents.available, false);
  assert.equal(snapshot.alerts.active, 1);
});

test('an aborted signal rejects', async () => {
  const source = createEmergencyCompositeSource({
    readLayers: () => layers(),
    fetchImpl: ipawsFetch([]),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(source.getSnapshot({ signal: controller.signal }));
});
