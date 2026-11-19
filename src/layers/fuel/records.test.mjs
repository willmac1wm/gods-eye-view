import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FUEL_SERIES,
  normalizeEiaSeriesResponse,
  latestPerSeries,
  heatingOilStatus,
} from './records.js';

// Verbatim-shaped EIA v2 payloads (week of 2026-11-09 values, live 2026-11-16).
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

const gndRows = [
  {
    period: '2026-11-09',
    series: 'EMM_EPMR_PTE_R1Y_DPG',
    'series-description':
      'Central Atlantic (PADD 1B) Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)',
    value: 4.146,
    units: '$/GAL',
  },
  {
    period: '2026-11-02',
    series: 'EMM_EPMR_PTE_R1Y_DPG',
    'series-description':
      'Central Atlantic (PADD 1B) Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)',
    value: 4.232,
    units: '$/GAL',
  },
  {
    period: '2026-11-09',
    series: 'EMD_EPD2D_PTE_R1Y_DPG',
    'series-description':
      'Central Atlantic (PADD 1B) No 2 Diesel Retail Prices (Dollars per Gallon)',
    value: 6.412,
    units: '$/GAL',
  },
  {
    period: '2026-11-09',
    series: 'EMM_EPMR_PTE_NUS_DPG',
    'series-description':
      'U.S. Regular All Formulations Retail Gasoline Prices (Dollars per Gallon)',
    value: 3.995,
    units: '$/GAL',
  },
];

const wfrRows = [
  {
    period: '2026-11-09',
    series: 'W_EPD2F_PRS_SNJ_DPG',
    'series-description':
      'New Jersey No. 2 Heating Oil Residential Price (Dollars per Gallon)',
    value: 6.052,
    units: '$/GAL',
  },
  {
    period: '2026-11-09',
    series: 'W_EPD2F_PRS_R1Y_DPG',
    'series-description':
      'Central Atlantic (PADD 1B) No. 2 Heating Oil Residential Price (Dollars per Gallon)',
    value: 6.002,
    units: '$/GAL',
  },
];

test('the tracked series cover gas, diesel and heating oil with the NJ proxy marked', () => {
  assert.equal(FUEL_SERIES.length, 7);
  const gasPadd1b = FUEL_SERIES.find(
    (series) => series.id === 'EMM_EPMR_PTE_R1Y_DPG',
  );
  assert.equal(gasPadd1b.proxy, true);
  assert.equal(gasPadd1b.area, 'Central Atlantic (PADD 1B)');
  const heatNj = FUEL_SERIES.find(
    (series) => series.id === 'W_EPD2F_PRS_SNJ_DPG',
  );
  assert.equal(heatNj.proxy, false);
  assert.equal(heatNj.area, 'New Jersey');
});

test('gas/diesel payload groups by series, newest first', () => {
  const series = normalizeEiaSeriesResponse(eiaPayload(gndRows));
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.values.length, 2);
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.values[0].period, '2026-11-09');
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.values[0].value, 4.146);
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.values[1].value, 4.232);
  assert.equal(series.EMD_EPD2D_PTE_R1Y_DPG.values[0].value, 6.412);
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.unit, '$/GAL');
  const latest = latestPerSeries(series);
  assert.equal(latest.EMM_EPMR_PTE_R1Y_DPG.value, 4.146);
  assert.equal(latest.EMD_EPD2D_PTE_R1Y_DPG.value, 6.412);
});

test('heating-oil payload keeps the real NJ series', () => {
  const series = normalizeEiaSeriesResponse(eiaPayload(wfrRows));
  assert.equal(series.W_EPD2F_PRS_SNJ_DPG.values[0].value, 6.052);
  assert.equal(series.W_EPD2F_PRS_R1Y_DPG.values[0].value, 6.002);
});

test('bad rows are skipped, never zero-filled; untracked series ignored', () => {
  const series = normalizeEiaSeriesResponse(
    eiaPayload([
      ...gndRows,
      {
        period: '2026-11-09',
        series: 'EMM_EPMR_PTE_R1Y_DPG',
        value: null,
        units: '$/GAL',
      },
      {
        period: 'not-a-date',
        series: 'EMM_EPMR_PTE_R1Y_DPG',
        value: 9.99,
        units: '$/GAL',
      },
      {
        period: '2026-11-09',
        series: 'SOME_OTHER_SERIES',
        value: 1.23,
        units: '$/GAL',
      },
    ]),
  );
  assert.equal(series.EMM_EPMR_PTE_R1Y_DPG.values.length, 2);
  assert.equal(series.SOME_OTHER_SERIES, undefined);
});

test('malformed payloads reject wholesale', () => {
  assert.equal(normalizeEiaSeriesResponse(null), null);
  assert.equal(normalizeEiaSeriesResponse({}), null);
  assert.equal(normalizeEiaSeriesResponse({ response: {} }), null);
  assert.equal(normalizeEiaSeriesResponse(eiaPayload([])), null);
  assert.equal(
    normalizeEiaSeriesResponse(eiaPayload([{ period: '2026-11-09' }])),
    null,
  );
});

test('heating-oil freshness: current, stale, season-ended', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(heatingOilStatus('2026-11-09', now).state, 'current');
  assert.equal(heatingOilStatus('2026-10-26', now).state, 'stale');
  assert.equal(heatingOilStatus('2026-03-09', now).state, 'season-ended');
  assert.equal(heatingOilStatus(null, now).state, 'unknown');
  assert.equal(heatingOilStatus('garbage', now).state, 'unknown');
});

test('EIA v2 sends values as decimal strings, as the live API did on 2026-11-18', () => {
  const live = {
    response: {
      data: [
        {
          period: '2026-11-16',
          series: 'EMM_EPMR_PTE_R1Y_DPG',
          value: '4.064',
          units: '$/GAL',
        },
        {
          period: '2026-11-09',
          series: 'EMM_EPMR_PTE_R1Y_DPG',
          value: '4.146',
          units: '$/GAL',
        },
        {
          period: '2026-11-16',
          series: 'EMD_EPD2D_PTE_R1Y_DPG',
          value: '6.309',
          units: '$/GAL',
        },
        {
          period: '2026-11-16',
          series: 'EMM_EPMR_PTE_NUS_DPG',
          value: '',
          units: '$/GAL',
        },
        {
          period: '2026-11-16',
          series: 'EMD_EPD2D_PTE_NUS_DPG',
          value: 'n/a',
          units: '$/GAL',
        },
      ],
    },
  };
  const out = normalizeEiaSeriesResponse(live);
  assert.ok(out, 'string values are a real snapshot, not a malformed one');
  assert.deepEqual(out.EMM_EPMR_PTE_R1Y_DPG.values, [
    { period: '2026-11-16', value: 4.064 },
    { period: '2026-11-09', value: 4.146 },
  ]);
  assert.equal(out.EMD_EPD2D_PTE_R1Y_DPG.values[0].value, 6.309);
  // A blank or non-numeric value is skipped, never read as 0.
  assert.equal(out.EMM_EPMR_PTE_NUS_DPG, undefined);
  assert.equal(out.EMD_EPD2D_PTE_NUS_DPG, undefined);
});
