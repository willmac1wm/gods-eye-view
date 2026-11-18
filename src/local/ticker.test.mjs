import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCountyTicker, tickerItems, windText } from './ticker.js';

const NOW = Date.parse('2026-11-18T00:30:00Z');

const envelopes = {
  tide: {
    features: [
      {
        id: 'nwps:CAPN4',
        observed: {
          value: 1.58,
          time: '2026-11-17T23:06:00Z',
          category: 'no_flooding',
        },
        forecast: { value: 4.5, time: '2026-11-20T09:00:00Z' },
      },
    ],
  },
  airport: {
    features: [
      {
        id: 'metar:KWWD',
        observedAt: '2026-11-17T23:56:00Z',
        flightCategory: 'VFR',
        windDirDeg: 0,
        windKt: 0,
        gustKt: null,
        tempF: 41,
        rawMetar: 'METAR KWWD 172356Z AUTO 00000KT',
      },
    ],
  },
  sea: {
    features: [
      {
        id: 'ndbc:44009',
        title: 'DELAWARE BAY 26 NM Southeast of Cape May, NJ (44009)',
        reading: {
          observedAt: '2026-11-17T23:40:00Z',
          windDirDeg: 280,
          windSpeedKt: 5.8,
          gustKt: 7.8,
          waveHeightFt: 2.3,
          waterTempF: 55.4,
        },
      },
    ],
  },
  outages: {
    summary: {
      counties: [
        { county: 'Atlantic', out: 3 },
        { county: 'Cape May', out: 1 },
      ],
    },
  },
  alerts: { summary: { count: 0, warnings: 0, watches: 0, advisories: 0 } },
  // An EIA snapshot, as createEiaFuelSource().getSnapshot() resolves it.
  fuel: {
    fetchedAt: Date.parse('2026-11-18T00:10:00Z'),
    stale: false,
    latestWeek: '2026-11-16',
    latest: {
      EMM_EPMR_PTE_R1Y_DPG: { period: '2026-11-16', value: 4.064 },
      EMD_EPD2D_PTE_R1Y_DPG: { period: '2026-11-16', value: 6.309 },
    },
    heatingOil: { state: 'unknown', ageDays: null },
  },
};

test('the ticker reads tide, airport, sea, power, NWS and gas', () => {
  const items = tickerItems(envelopes, NOW);
  assert.deepEqual(
    items.map(({ key, label, value, tone, layerId }) => ({
      key,
      label,
      value,
      tone,
      layerId,
    })),
    [
      {
        key: 'tide',
        label: 'TIDE',
        value: '1.6 ft',
        tone: 'ok',
        layerId: 'tide-gauges',
      },
      {
        key: 'airport',
        label: 'KWWD',
        value: 'VFR',
        tone: 'ok',
        layerId: 'airport-weather',
      },
      {
        key: 'sea',
        label: 'SEA',
        value: 'W 6 G8 kt',
        tone: 'ok',
        layerId: 'marine-buoys',
      },
      {
        key: 'outages',
        label: 'POWER',
        value: '1 out',
        tone: 'watch',
        layerId: 'power-outages',
      },
      {
        key: 'alerts',
        label: 'NWS',
        value: 'no alerts',
        tone: 'ok',
        layerId: 'nws-alerts',
      },
      {
        key: 'fuel',
        label: 'GAS',
        value: '$4.06',
        tone: 'ok',
        layerId: 'fuel-prices',
      },
    ],
  );
  assert.match(items[0].detail, /^peak 4\.5 ft Fri/);
  assert.equal(items[1].detail, '41°F · calm');
  assert.equal(items[2].detail, 'waves 2.3 ft · water 55°F');
  assert.equal(items[5].detail, 'Mid-Atlantic avg');
});

test('flooding and alerts raise the tone, and the flood stage replaces the peak', () => {
  const flooding = structuredClone(envelopes);
  flooding.tide.features[0].observed.category = 'moderate';
  flooding.alerts.summary = {
    count: 2,
    warnings: 1,
    watches: 0,
    top: { title: 'Coastal Flood Warning' },
  };
  const items = tickerItems(flooding, NOW);
  assert.equal(items[0].tone, 'warn');
  assert.equal(items[0].detail, 'moderate flooding');
  assert.equal(items[4].value, 'Coastal Flood Warning');
  assert.equal(items[4].detail, '+1 more');
  assert.equal(items[4].tone, 'danger');
});

test('a missing or stale source shows a muted item, never a guess', () => {
  const items = tickerItems({}, NOW);
  assert.equal(items.length, 6);
  assert.ok(
    items.every(({ value, tone }) => value === '—' && tone === 'muted'),
  );
  assert.deepEqual(
    { label: items[5].label, layerId: items[5].layerId },
    { label: 'GAS', layerId: 'fuel-prices' },
  );
  const old = structuredClone(envelopes);
  old.tide.features[0].observed.time = '2026-11-17T12:00:00Z';
  assert.equal(tickerItems(old, NOW)[0].tone, 'muted');
});

test('wind reads calm, a compass point and gusts only when higher', () => {
  assert.equal(windText(0, 0, null), 'calm');
  assert.equal(windText(45, 12, 12), 'NE 12 kt');
  assert.equal(windText(225, 12, 20), 'SW 12 G20 kt');
  assert.equal(windText(10, null, null), '');
});

test('the strip renders, a click turns the layer on, and dispose removes it', async () => {
  document.body.replaceChildren();
  const enabled = new Set();
  const dataManager = {
    isEnabled: (id) => enabled.has(id),
    setEnabled: (id, on) => (on ? enabled.add(id) : enabled.delete(id)),
  };
  const fetched = [];
  const opened = [];
  const dispose = installCountyTicker({
    dataManager,
    openDetails: (record) => opened.push(record),
    fetchFuel: async ({ signal }) => {
      assert.ok(signal instanceof AbortSignal);
      return envelopes.fuel;
    },
    fetchSource: async (name) => {
      fetched.push(name);
      return {
        'tide-gauges': envelopes.tide,
        'airport-weather': envelopes.airport,
        'marine-buoys': envelopes.sea,
        'power-outages': envelopes.outages,
        'nws-alerts': envelopes.alerts,
      }[name];
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const strip = document.getElementById('gev-county-ticker');
  assert.ok(strip);
  assert.deepEqual(fetched.sort(), [
    'airport-weather',
    'marine-buoys',
    'nws-alerts',
    'power-outages',
    'tide-gauges',
  ]);
  assert.match(strip.textContent, /TIDE\s+1\.6 ft/);
  strip
    .querySelector('[data-layer-id="tide-gauges"] .gev-ticker-value')
    .click();
  assert.ok(enabled.has('tide-gauges'));
  assert.equal(opened.length, 0, 'only GAS opens a card');
  assert.match(strip.textContent, /GAS\s+\$4\.06\s+Mid-Atlantic avg/);
  strip.querySelector('[data-key="fuel"] .gev-ticker-label').click();
  assert.ok(enabled.has('fuel-prices'));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].title, 'Gas $4.06 · Diesel $6.31');
  assert.equal(opened[0].links.length, 2);
  dispose();
  assert.equal(document.getElementById('gev-county-ticker'), null);
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('with no gas price, GAS shows a dash and its card still opens with the links', async () => {
  document.body.replaceChildren();
  const opened = [];
  const dispose = installCountyTicker({
    openDetails: (record) => opened.push(record),
    fetchSource: async () => {
      throw new Error('offline');
    },
    fetchFuel: async () => {
      throw new Error('Fuel HTTP 503');
    },
  });
  await settle();
  const strip = document.getElementById('gev-county-ticker');
  assert.match(strip.textContent, /GAS\s+—/);
  strip.querySelector('[data-key="fuel"]').click();
  assert.equal(opened.length, 1);
  assert.equal(opened[0].status, 'unavailable');
  assert.equal(opened[0].links.length, 2);
  dispose();
});

test('GAS is checked hourly, and a failed check keeps the last price', async () => {
  document.body.replaceChildren();
  let clock = Date.parse('2026-11-18T00:30:00Z');
  const calls = [];
  let answer = 'ok';
  let tick = null;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  globalThis.clearInterval = () => {};
  try {
    const stop = installCountyTicker({
      now: () => clock,
      fuelRefreshMs: 60 * 60 * 1000,
      fuelRetryMs: 10 * 60 * 1000,
      fetchSource: async () => ({}),
      fetchFuel: async () => {
        calls.push(clock);
        if (answer === 'fail') throw new Error('Fuel HTTP 503');
        return envelopes.fuel;
      },
    });
    await settle();
    assert.equal(calls.length, 1, 'first refresh fetches fuel');
    clock += 2 * 60 * 1000;
    tick();
    await settle();
    assert.equal(calls.length, 1, 'not again within the hour');
    answer = 'fail';
    clock += 60 * 60 * 1000;
    tick();
    await settle();
    assert.equal(calls.length, 2, 'checked again after an hour');
    const live = document.getElementById('gev-county-ticker');
    assert.match(
      live.textContent,
      /GAS\s+\$4\.06/,
      'a failed check keeps the last price',
    );
    clock += 2 * 60 * 1000;
    tick();
    await settle();
    assert.equal(calls.length, 2, 'with a price in hand, wait the full hour');
    stop();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('with no price, GAS is retried after the retry window, not every refresh', async () => {
  document.body.replaceChildren();
  let clock = Date.parse('2026-11-18T00:30:00Z');
  const calls = [];
  let tick = null;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  globalThis.clearInterval = () => {};
  try {
    const stop = installCountyTicker({
      now: () => clock,
      fuelRetryMs: 10 * 60 * 1000,
      fetchSource: async () => ({}),
      fetchFuel: async () => {
        calls.push(clock);
        throw new Error('Fuel HTTP 503');
      },
    });
    await settle();
    assert.equal(calls.length, 1);
    clock += 2 * 60 * 1000;
    tick();
    await settle();
    assert.equal(calls.length, 1, 'not on the next 2-minute refresh');
    clock += 9 * 60 * 1000;
    tick();
    await settle();
    assert.equal(calls.length, 2, 'retried once 10 minutes have passed');
    stop();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});
