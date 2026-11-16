import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSurfZoneForecast,
  countRecentCalls,
  buildNativeCountyStatus,
} from './countyNative.js';

const SRF_TEXT = `000
SRFP...
...ATLANTIC COASTAL CAPE MAY...
.TODAY...Partly sunny.
Rip Current Risk......Moderate
Surf Height......2 to 3 feet.
$$
`;

test('parseSurfZoneForecast reads risk, surf and day for NJZ024', () => {
  const parsed = parseSurfZoneForecast(
    `...NJZ024 ATLANTIC COASTAL CAPE MAY...\n${SRF_TEXT}`,
  );
  assert.equal(parsed.risk, 'Moderate');
  assert.equal(parsed.surf, '2 to 3 feet');
  assert.equal(parsed.day, 'Today');
});

test('parseSurfZoneForecast returns null without the zone or the risk line', () => {
  assert.equal(parseSurfZoneForecast('no zones here'), null);
  assert.equal(
    parseSurfZoneForecast('NJZ024 ...\nSurf Height......2 feet.\n$$'),
    null,
  );
});

test('countRecentCalls counts the last 1 h and 24 h from incident timestamps', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const counts = countRecentCalls(
    [
      { timestamp: '2026-11-16T11:30:00Z' },
      { timestamp: '2026-11-16T06:00:00Z' },
      { timestamp: '2026-11-15T13:00:00Z' },
      { timestamp: '2026-11-14T12:00:00Z' },
      { timestamp: 'not-a-date' },
      {},
    ],
    now,
  );
  assert.deepEqual(counts, { calls_1h: 1, calls_24h: 3 });
});

const NOW = Date.parse('2026-11-16T13:15:00Z');
const NWPS_ACYN4 = {
  lid: 'ACYN4',
  status: {
    observed: {
      primary: 2.61,
      floodCategory: 'no_flooding',
      validTime: '2026-11-16T12:36:00Z',
    },
    forecast: {
      primary: 4.8,
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

function jsonResponse(payload) {
  return {
    ok: true,
    headers: { get: () => null },
    body: { cancel: async () => {} },
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

test('buildNativeCountyStatus assembles tide, rip, power and call counts', async () => {
  const range = [];
  for (let m = 0; m <= 114; m += 6) {
    const at = new Date(Date.parse('2026-11-16T11:18:00Z') + m * 60_000);
    const hh = String(at.getUTCHours()).padStart(2, '0');
    const mm = String(at.getUTCMinutes()).padStart(2, '0');
    range.push({
      t: `2026-11-16 ${hh}:${mm}`,
      v: (1.85 + m * 0.005).toFixed(3),
    });
  }
  range[range.length - 1].v = '2.507';
  const fetchImpl = async (url) => {
    const text = String(url);
    if (text.includes('api.water.noaa.gov')) {
      if (text.endsWith('/acyn4')) return jsonResponse(NWPS_ACYN4);
      return { ok: false, status: 404, json: async () => ({ code: 5 }) };
    }
    if (text.includes('product=water_level')) {
      return jsonResponse({ metadata: { id: '8536110' }, data: range });
    }
    if (text.includes('product=predictions')) {
      return jsonResponse({
        predictions: [
          { t: '2026-11-16 05:45', v: '3.841', type: 'H' },
          { t: '2026-11-16 11:36', v: '1.054', type: 'L' },
          { t: '2026-11-16 18:04', v: '4.779', type: 'H' },
          { t: '2026-11-17 00:28', v: '0.888', type: 'L' },
        ],
      });
    }
    if (text.includes('services1.arcgis.com')) {
      return jsonResponse({
        features: [
          { attributes: { County: 'Cape May', CustomersOut: 0 } },
          { attributes: { County: 'Atlantic', CustomersOut: 4 } },
        ],
      });
    }
    if (text.includes('/api/incidents')) {
      return jsonResponse([
        {
          id: 1,
          created_at: '2026-11-16T12:30:00Z',
          lat: 39.0,
          lng: -74.9,
          incident_type: 'Fire',
        },
        {
          id: 2,
          created_at: '2026-11-16T06:00:00Z',
          lat: 39.0,
          lng: -74.9,
          incident_type: 'EMS',
        },
        {
          id: 3,
          created_at: '2026-11-15T12:00:00Z',
          lat: 39.0,
          lng: -74.9,
          incident_type: 'Fire',
        },
      ]);
    }
    if (text.includes('/products/types/SRF/')) {
      return jsonResponse({ '@graph': [{ id: 'srf-phi-1' }] });
    }
    if (text.includes('/products/srf-phi-1')) {
      return jsonResponse({
        productText: `...NJZ024 ATLANTIC COASTAL CAPE MAY...\n${SRF_TEXT}`,
        issuanceTime: '2026-11-16T10:00:00Z',
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };
  const previousFirewireUrl = process.env.FIREWIRE_URL;
  process.env.FIREWIRE_URL = 'http://127.0.0.1:8000';
  try {
    const status = await buildNativeCountyStatus({ fetchImpl, now: () => NOW });
    assert.equal(status.calls_1h, 1);
    assert.equal(status.calls_24h, 2);
    assert.equal(status.tide.level_ft, 2.507);
    assert.equal(status.tide.category, 'no_flooding');
    assert.equal(status.tide.flooding_now, false);
    assert.equal(status.rip_current.risk, 'Moderate');
    assert.equal(status.rip_current.surf, '2 to 3 feet');
    assert.equal(status.power.county.out, 0);
    assert.equal(status.source, 'native');
  } finally {
    if (previousFirewireUrl === undefined) delete process.env.FIREWIRE_URL;
    else process.env.FIREWIRE_URL = previousFirewireUrl;
  }
});

test('buildNativeCountyStatus degrades when every upstream is down', async () => {
  const status = await buildNativeCountyStatus({
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    now: () => NOW,
  });
  assert.equal(status.calls_1h, 0);
  assert.equal(status.calls_24h, 0);
  assert.equal(status.tide.level_ft, null);
  assert.equal(status.tide.flooding_now, false);
  assert.equal(status.rip_current.error != null, true);
  assert.equal(status.power.county.out, 0);
});
