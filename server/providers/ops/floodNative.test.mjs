import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNativeFloodPayload } from './floodNative.js';

const NOW = Date.parse('2026-11-16T13:15:00Z');

// Trimmed live shapes, 2026-11-16: NWPS ACYN4 (api.water.noaa.gov) and
// CO-OPS 8536110 water_level range + predictions hilo.
const NWPS_ACYN4 = {
  lid: 'ACYN4',
  status: {
    observed: {
      primary: 2.61,
      primaryUnit: 'ft',
      floodCategory: 'no_flooding',
      validTime: '2026-11-16T12:36:00Z',
    },
    forecast: {
      primary: 4.8,
      primaryUnit: 'ft',
      floodCategory: 'no_flooding',
      validTime: '2026-11-16T17:00:00Z',
    },
  },
  flood: {
    categories: {
      action: { stage: -9999 },
      minor: { stage: 6 },
      moderate: { stage: 7 },
      major: { stage: 8 },
    },
  },
};

function coopsRange(rows) {
  return {
    metadata: { id: '8536110', name: 'Cape May' },
    data: rows.map(([t, v]) => ({
      t,
      v: String(v),
      s: '0.03',
      f: '0,0,0,0',
      q: 'p',
    })),
  };
}

const COOPS_PREDS = {
  predictions: [
    { t: '2026-11-16 05:45', v: '3.841', type: 'H' },
    { t: '2026-11-16 11:36', v: '1.054', type: 'L' },
    { t: '2026-11-16 18:04', v: '4.779', type: 'H' },
    { t: '2026-11-17 00:28', v: '0.888', type: 'L' },
  ],
};

function quietRange() {
  const rows = [];
  for (let m = 0; m <= 114; m += 6) {
    const at = new Date(Date.parse('2026-11-16T11:18:00Z') + m * 60_000);
    const hh = String(at.getUTCHours()).padStart(2, '0');
    const mm = String(at.getUTCMinutes()).padStart(2, '0');
    rows.push([`2026-11-16 ${hh}:${mm}`, (1.85 + m * 0.005).toFixed(3)]);
  }
  rows[rows.length - 1][1] = '2.507';
  return rows;
}

function stubFetch({ rangeRows, nwps = NWPS_ACYN4 } = {}) {
  return async (url) => {
    const text = String(url);
    if (text.includes('api.water.noaa.gov')) {
      if (text.endsWith('/acyn4')) {
        return { ok: true, json: async () => nwps };
      }
      return { ok: false, status: 404, json: async () => ({ code: 5 }) };
    }
    if (text.includes('product=water_level')) {
      return { ok: true, json: async () => coopsRange(rangeRows) };
    }
    if (text.includes('product=predictions')) {
      return { ok: true, json: async () => COOPS_PREDS };
    }
    throw new Error(`unexpected fetch ${text}`);
  };
}

test('fetchNativeFloodPayload reads the real NWPS + CO-OPS shapes', async () => {
  const payload = await fetchNativeFloodPayload({
    fetchImpl: stubFetch({ rangeRows: quietRange() }),
    now: () => NOW,
  });
  const capeMay = payload.gauges.find((g) => g.id === 'cmhn4');
  assert.equal(capeMay.level_ft, 2.507);
  assert.equal(capeMay.category, 'no_flooding');
  assert.equal(capeMay.source, 'native-coops');
  assert.equal(capeMay.forecast_ft, 4.779);
  // 1 h trend: latest 2.507 ft at 13:12 vs 2.120 ft at 12:12 (nearest to 12:15).
  assert.ok(Math.abs(capeMay.trend_ft_per_hr - 0.387) < 0.001);
  const atlanticCity = payload.gauges.find((g) => g.id === 'acyn4');
  assert.equal(atlanticCity.level_ft, 2.61);
  assert.equal(atlanticCity.category, 'no_flooding');
  assert.equal(atlanticCity.forecast_ft, 4.8);
  assert.equal(atlanticCity.forecast_category, 'no_flooding');
  // BRNN4 is not in NWPS v1: null-tolerant, still listed.
  const brandywine = payload.gauges.find((g) => g.id === 'brnn4');
  assert.equal(brandywine.level_ft, null);
  assert.equal(brandywine.category, 'unknown');
  assert.equal(payload.floodwatch.station_id, 'cmhn4');
  assert.equal(payload.floodwatch.level_ft, 2.507);
  assert.equal(payload.floodwatch.flooding_now, false);
  assert.equal(payload.floodwatch.next_high_tide.level_ft, 4.779);
  assert.equal(payload.plan.flooding, false);
  assert.equal(payload.plan.max_level, 2.507);
});

test('fetchNativeFloodPayload flags flooding at the minor stage', async () => {
  const rows = quietRange().map(([t, v]) => [t, v]);
  rows[rows.length - 1][1] = '6.5';
  rows[rows.length - 2][1] = '6.4';
  const payload = await fetchNativeFloodPayload({
    fetchImpl: stubFetch({ rangeRows: rows }),
    now: () => NOW,
  });
  assert.equal(payload.floodwatch.level_ft, 6.5);
  assert.equal(payload.floodwatch.category, 'action');
  assert.equal(payload.floodwatch.flooding_now, true);
  assert.equal(payload.plan.flooding, true);
  assert.equal(payload.plan.max_level, 6.5);
});

test('fetchNativeFloodPayload degrades to nulls when every upstream is down', async () => {
  const payload = await fetchNativeFloodPayload({
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    now: () => NOW,
  });
  assert.equal(payload.gauges.length, 3);
  assert.ok(payload.gauges.every((g) => g.level_ft === null));
  assert.equal(payload.floodwatch.level_ft, null);
  assert.equal(payload.floodwatch.flooding_now, false);
  assert.equal(payload.plan.flooding, false);
});
