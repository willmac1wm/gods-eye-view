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
};

test('the ticker reads tide, airport, sea, power and NWS from the local envelopes', () => {
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
    ],
  );
  assert.match(items[0].detail, /^peak 4\.5 ft Fri/);
  assert.equal(items[1].detail, '41°F · calm');
  assert.equal(items[2].detail, 'waves 2.3 ft · water 55°F');
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
  assert.equal(items.length, 5);
  assert.ok(
    items.every(({ value, tone }) => value === '—' && tone === 'muted'),
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
  const dispose = installCountyTicker({
    dataManager,
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
  dispose();
  assert.equal(document.getElementById('gev-county-ticker'), null);
});
