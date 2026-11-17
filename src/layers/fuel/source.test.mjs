import assert from 'node:assert/strict';
import test from 'node:test';
import { createEiaFuelSource, EiaKeyMissingError } from './source.js';

function eiaPayload(rows) {
  return {
    response: {
      total: String(rows.length),
      dateFormat: 'YYYY-MM-DD',
      frequency: 'weekly',
      data: rows,
    },
  };
}

const gnd = eiaPayload([
  {
    period: '2026-11-09',
    series: 'EMM_EPMR_PTE_R1Y_DPG',
    value: 4.146,
    units: '$/GAL',
  },
  {
    period: '2026-11-09',
    series: 'EMD_EPD2D_PTE_R1Y_DPG',
    value: 6.412,
    units: '$/GAL',
  },
]);

const wfr = eiaPayload([
  {
    period: '2026-11-09',
    series: 'W_EPD2F_PRS_SNJ_DPG',
    value: 6.052,
    units: '$/GAL',
  },
]);

function stubFetch(payload, status = 200) {
  return async (url) => {
    assert.equal(url, '/api/fuel');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    };
  };
}

test('snapshot combines both routes and flags heating oil current', async () => {
  const source = createEiaFuelSource({
    fetchImpl: stubFetch({
      fetchedAt: 1,
      stale: false,
      ttlMs: 21600000,
      latestWeek: '2026-11-09',
      gnd,
      wfr,
    }),
    now: () => Date.parse('2026-11-16T12:00:00Z'),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.latestWeek, '2026-11-09');
  assert.equal(snapshot.latest.EMM_EPMR_PTE_R1Y_DPG.value, 4.146);
  assert.equal(snapshot.latest.EMD_EPD2D_PTE_R1Y_DPG.value, 6.412);
  assert.equal(snapshot.latest.W_EPD2F_PRS_SNJ_DPG.value, 6.052);
  assert.equal(snapshot.heatingOil.state, 'current');
  assert.equal(snapshot.stale, false);
});

test('an old heating-oil week reports season-ended, never a fresh price', async () => {
  const source = createEiaFuelSource({
    fetchImpl: stubFetch({
      fetchedAt: 1,
      stale: false,
      latestWeek: '2026-03-09',
      gnd,
      wfr: eiaPayload([
        {
          period: '2026-03-09',
          series: 'W_EPD2F_PRS_SNJ_DPG',
          value: 5.5,
          units: '$/GAL',
        },
      ]),
    }),
    now: () => Date.parse('2026-11-16T12:00:00Z'),
  });
  const snapshot = await source.getSnapshot({});
  assert.equal(snapshot.heatingOil.state, 'season-ended');
  assert.equal(snapshot.latest.W_EPD2F_PRS_SNJ_DPG.value, 5.5);
});

test('a malformed proxy payload throws instead of half-rendering', async () => {
  const source = createEiaFuelSource({
    fetchImpl: stubFetch({ gnd, wfr: { response: {} } }),
  });
  await assert.rejects(() => source.getSnapshot({}), /Malformed/);
});

test('proxy 503 no_key throws the typed key-missing error', async () => {
  const source = createEiaFuelSource({
    fetchImpl: stubFetch({ error: 'no_key' }, 503),
  });
  await assert.rejects(
    () => source.getSnapshot({}),
    (error) => error instanceof EiaKeyMissingError,
  );
});

test('a proxy 502 throws with the status', async () => {
  const source = createEiaFuelSource({
    fetchImpl: stubFetch({ error: 'EIA fetch failed' }, 502),
  });
  await assert.rejects(() => source.getSnapshot({}), /Fuel HTTP 502/);
});
