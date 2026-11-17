import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpaceWeatherSource } from './source.js';

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function payload() {
  return {
    fetchedAt: 1,
    stale: false,
    kpMinute: [
      { time_tag: '2026-11-16T22:26:00', kp_index: 0, estimated_kp: 0.33, kp: '0P' },
      { time_tag: '2026-11-16T22:27:00', kp_index: 0, estimated_kp: 0.0, kp: '0Z' },
    ],
    kpForecast: [
      { time_tag: '2026-11-16T00:00:00', kp: 3.0, observed: 'observed', noaa_scale: null },
      { time_tag: '2026-11-18T00:00:00', kp: 4.67, observed: 'predicted', noaa_scale: 'G1' },
    ],
    threeDayText:
      'The greatest observed 3 hr Kp over the past 24 hours was 1 (below NOAA Scale levels).\n' +
      'The greatest expected 3 hr Kp for Nov 16-Nov 18 2026 is 4.67 (NOAA Scale G1).\n',
    aceSwepam: [
      { time_tag: '2026-11-16T22:01:00', density: 5.4, speed: 418, temperature: 118000 },
    ],
    aceMag: [{ time_tag: '2026-11-16T22:01:00', bt: 6.5, bz_gsm: -2.4 }],
  };
}

test('getSnapshot returns Kp 0 with the G1 forecast (live values)', async () => {
  const source = createSpaceWeatherSource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/space-weather');
      return okResponse(payload());
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.kp.kp, 0);
  assert.equal(snapshot.kp.activity, 'quiet');
  assert.equal(snapshot.forecast.maxKp, 4.67);
  assert.equal(snapshot.forecast.maxScale, 'G1');
  assert.equal(snapshot.threeDay.greatestExpectedKp, 4.67);
  assert.equal(snapshot.solarWind.speed, 418);
  assert.equal(snapshot.mag.bzGsm, -2.4);
});

test('getSnapshot tolerates missing slow products', async () => {
  const source = createSpaceWeatherSource({
    fetchImpl: async () =>
      okResponse({ ...payload(), kpForecast: null, threeDayText: null }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.kp.kp, 0);
  assert.equal(snapshot.forecast, null);
  assert.equal(snapshot.threeDay, null);
});

test('getSnapshot throws on HTTP failure and on a missing Kp feed', async () => {
  const failing = createSpaceWeatherSource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 502/);
  const malformed = createSpaceWeatherSource({
    fetchImpl: async () => okResponse({ ...payload(), kpMinute: [] }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed Kp/);
});
