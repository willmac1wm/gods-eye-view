import assert from 'node:assert/strict';
import test from 'node:test';
import { createNwsAlertCardSource } from './source.js';

const FREEZE_WARNING = {
  id: 'https://api.weather.gov/alerts/NWS-IDP-PROD-1',
  event: 'Freeze Warning',
  headline: 'Freeze Warning issued November 14 at 12:56AM EST until November 14 at 9:00AM EST by NWS Mount Holly',
  area: 'Cape May',
  severity: 'Severe',
  instruction: 'Take steps now to protect tender plants from the cold.',
  description: 'Sub-freezing temperatures are expected.',
  effective: '2026-11-14T05:56:00+00:00',
  expires: '2026-11-14T14:00:00+00:00',
  onset: '2026-11-14T05:56:00+00:00',
  senderName: 'NWS Mount Holly NJ',
  geometry: null,
};

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

test('getSnapshot returns glossed alerts from /api/nws', async () => {
  const source = createNwsAlertCardSource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/nws');
      return okResponse({
        nws_alerts: [FREEZE_WARNING],
        feeds: {},
        updatedAt: '2026-11-16T22:25:07.000Z',
        stale: false,
      });
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.alerts.length, 1);
  assert.equal(snapshot.alerts[0].plain, 'Hard freeze tonight');
  assert.equal(snapshot.stale, false);
});

test('getSnapshot returns an empty card when no alerts are active', async () => {
  const source = createNwsAlertCardSource({
    fetchImpl: async () =>
      okResponse({ nws_alerts: [], feeds: {}, updatedAt: '2026-11-16T22:25:07.000Z' }),
  });
  const snapshot = await source.getSnapshot();
  assert.deepEqual(snapshot.alerts, []);
});

test('getSnapshot throws on HTTP failure and on a malformed payload', async () => {
  const failing = createNwsAlertCardSource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 502/);
  const malformed = createNwsAlertCardSource({
    fetchImpl: async () => okResponse({ nws_alerts: 'nope' }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed/);
});
