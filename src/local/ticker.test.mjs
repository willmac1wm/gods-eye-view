import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { installCountyTicker, tickerItems, windText } from './ticker.js';

// The strip also reads /api/local/events; these tests have no server.
const noEvents = async () => null;

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
    fetchEvents: noEvents,
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
    fetchEvents: noEvents,
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
      fetchEvents: noEvents,
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
      fetchEvents: noEvents,
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

// --- LATEST: the newest event of the last hour, from /api/local/events ---

const sources = {
  'tide-gauges': envelopes.tide,
  'airport-weather': envelopes.airport,
  'marine-buoys': envelopes.sea,
  'power-outages': envelopes.outages,
  'nws-alerts': envelopes.alerts,
};
const fetchAll = async (name) => sources[name];
const fireEvent = {
  id: 'call:fw:881#new',
  key: 'call:fw:881',
  kind: 'call',
  change: 'new',
  title: 'Fire reported',
  place: 'Rio Grande',
  detail: 'Structure fire',
  at: Date.parse('2026-11-18T01:42:00Z'),
  seenAt: Date.parse('2026-11-18T01:43:00Z'),
  lat: 39.019,
  lon: -74.877,
  layer: 'scanner-calls',
  severity: 'warn',
  source: 'Fire Wire scanner',
  threadId: 'call:fw:881#new',
  related: [],
};
const eventsData = {
  generatedAt: Date.parse('2026-11-18T01:50:00Z'),
  summary: { at: Date.parse('2026-11-18T01:50:00Z'), lines: [] },
  sources: [],
  events: [fireEvent],
};

test('LATEST leads the strip, and a click opens the event without a layer toggle', async () => {
  document.body.replaceChildren();
  const enabled = new Set();
  const opened = [];
  const dispose = installCountyTicker({
    dataManager: {
      isEnabled: (id) => enabled.has(id),
      setEnabled: (id, on) => (on ? enabled.add(id) : enabled.delete(id)),
    },
    now: () => Date.parse('2026-11-18T02:00:00Z'),
    fetchSource: fetchAll,
    fetchFuel: async () => envelopes.fuel,
    fetchEvents: async ({ signal }) => {
      assert.ok(signal instanceof AbortSignal);
      return eventsData;
    },
    openEvent: (id) => opened.push(id),
  });
  await settle();
  const strip = document.getElementById('gev-county-ticker');
  const buttons = [...strip.querySelectorAll('.gev-ticker-item')];
  assert.deepEqual(
    buttons.map((button) => button.dataset.key),
    ['events', 'tide', 'airport', 'sea', 'outages', 'alerts', 'fuel'],
  );
  const latest = buttons[0];
  assert.equal(latest.textContent, 'LATEST 8:42 PM Fire reported · Rio Grande');
  assert.equal(latest.dataset.eventId, 'call:fw:881#new');
  assert.ok(latest.classList.contains('tone-warn'));
  assert.match(latest.title, /Fire Wire scanner/);
  latest.querySelector('.gev-ticker-value').click();
  assert.deepEqual(opened, ['call:fw:881#new']);
  assert.equal(enabled.size, 0, 'LATEST opens the event, not a layer');
  strip.querySelector('[data-key="tide"]').click();
  assert.ok(enabled.has('tide-gauges'), 'the other items still toggle');
  dispose();
});

test('LATEST is gone once the newest event is over an hour old', async () => {
  document.body.replaceChildren();
  let clock = Date.parse('2026-11-18T02:30:00Z');
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
      fetchSource: fetchAll,
      fetchFuel: async () => envelopes.fuel,
      // The server's clock agrees with this device's.
      fetchEvents: async () => ({ ...eventsData, generatedAt: clock }),
    });
    await settle();
    const strip = document.getElementById('gev-county-ticker');
    assert.equal(strip.querySelector('.gev-ticker-item').dataset.key, 'events');
    clock = Date.parse('2026-11-18T02:43:00Z'); // 61 min after 01:42Z
    tick();
    await settle();
    assert.equal(strip.querySelector('[data-key="events"]'), null);
    assert.equal(strip.querySelector('.gev-ticker-item').dataset.key, 'tide');
    stop();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('an events failure never blanks the other items, and a kept answer stays', async () => {
  document.body.replaceChildren();
  let tick = null;
  let answer = 'ok';
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  globalThis.clearInterval = () => {};
  try {
    const stop = installCountyTicker({
      now: () => Date.parse('2026-11-18T02:00:00Z'),
      fetchSource: fetchAll,
      fetchFuel: async () => envelopes.fuel,
      fetchEvents: async () => {
        if (answer === 'throw') throw new Error('Events HTTP 503');
        if (answer === 'garbage') return 'not an object';
        return eventsData;
      },
    });
    await settle();
    const strip = document.getElementById('gev-county-ticker');
    assert.match(strip.textContent, /^LATEST 8:42 PM Fire reported/);
    for (const failure of ['throw', 'garbage']) {
      answer = failure;
      tick();
      await settle();
      assert.match(strip.textContent, /TIDE\s+1\.6 ft/, failure);
      assert.match(strip.textContent, /GAS\s+\$4\.06/, failure);
      assert.match(
        strip.textContent,
        /^LATEST 8:42 PM Fire reported/,
        `${failure}: the last good answer is kept`,
      );
    }
    stop();
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }

  document.body.replaceChildren();
  const stop = installCountyTicker({
    fetchSource: fetchAll,
    fetchFuel: async () => envelopes.fuel,
    fetchEvents: () => {
      throw new Error('synchronous failure');
    },
  });
  await settle();
  const strip = document.getElementById('gev-county-ticker');
  assert.equal(strip.querySelectorAll('.gev-ticker-item').length, 6);
  assert.equal(strip.querySelector('[data-key="events"]'), null);
  stop();
});

const hasLatest = (strip) =>
  strip.querySelector('[data-key="events"]') !== null;

/** Stand-in for setInterval: tick() runs one refresh by hand. */
async function withTicks(run) {
  let tick = null;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn) => {
    tick = fn;
    return 1;
  };
  globalThis.clearInterval = () => {};
  try {
    await run(async () => {
      tick();
      await settle();
    });
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

test('by default the strip reads /api/local/events once per refresh, ?since= by the server clock', async () => {
  document.body.replaceChildren();
  const realFetch = globalThis.fetch;
  const requests = [];
  let clock = Date.parse('2026-11-18T02:00:00Z');
  // The server's clock runs 10 minutes behind this device's.
  let serverClock = Date.parse('2026-11-18T01:50:00Z');
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...eventsData, generatedAt: serverClock }),
    };
  };
  try {
    await withTicks(async (tick) => {
      const opened = [];
      const stop = installCountyTicker({
        now: () => clock,
        fetchSource: fetchAll,
        fetchFuel: async () => envelopes.fuel,
        openEvent: (id) => opened.push(id),
      });
      await settle();
      assert.deepEqual(
        requests.map(({ url, init }) => [url, init.credentials]),
        [['/api/local/events', 'same-origin']],
        'the first read asks for the whole list, with no ?since=',
      );
      const latest = document.querySelector(
        '#gev-county-ticker [data-key="events"]',
      );
      assert.ok(latest);
      latest.click();
      assert.deepEqual(opened, ['call:fw:881#new']);

      clock += 2 * 60 * 1000;
      serverClock += 2 * 60 * 1000;
      await tick();
      assert.equal(requests.length, 2, 'one events read per refresh');
      assert.equal(
        requests[1].url,
        // 01:50Z (the last answer's generatedAt) less 65 minutes, not
        // this device's 02:00Z less 65 minutes.
        `/api/local/events?since=${Date.parse('2026-11-18T00:45:00Z')}`,
      );
      clock += 2 * 60 * 1000;
      serverClock += 2 * 60 * 1000;
      await tick();
      assert.equal(requests.length, 3, 'one events read per refresh');
      assert.equal(
        requests[2].url,
        `/api/local/events?since=${Date.parse('2026-11-18T00:47:00Z')}`,
      );
      assert.equal(
        document.getElementById('gev-county-ticker').dataset.events,
        'ok',
      );
      stop();
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a device clock hours off still shows LATEST: ?since= and the hour follow the server', async () => {
  const server = Date.parse('2026-11-18T01:50:00Z'); // 8:50 PM EST
  for (const offHours of [3, -3]) {
    document.body.replaceChildren();
    let clock = server + offHours * 3_600_000;
    let serverClock = server;
    const asked = [];
    await withTicks(async (tick) => {
      const stop = installCountyTicker({
        now: () => clock,
        fetchSource: fetchAll,
        fetchFuel: async () => envelopes.fuel,
        fetchEvents: async ({ signal, since }) => {
          assert.ok(signal instanceof AbortSignal);
          asked.push(since);
          return { ...eventsData, generatedAt: serverClock };
        },
      });
      await settle();
      const strip = document.getElementById('gev-county-ticker');
      const label = `device clock ${offHours} h off`;
      assert.equal(
        strip.querySelector('.gev-ticker-item').dataset.key,
        'events',
        label,
      );
      assert.match(strip.textContent, /^LATEST 8:42 PM Fire reported/, label);
      clock += 2 * 60 * 1000;
      serverClock += 2 * 60 * 1000;
      await tick();
      assert.deepEqual(asked, [undefined, server - 65 * 60 * 1000], label);
      assert.equal(
        strip.querySelector('.gev-ticker-item').dataset.key,
        'events',
        label,
      );
      // The hour is counted on the server's clock: 02:43Z is 01:42Z + 61 min.
      clock += 51 * 60 * 1000;
      serverClock += 51 * 60 * 1000;
      await tick();
      assert.equal(serverClock, Date.parse('2026-11-18T02:43:00Z'));
      assert.equal(hasLatest(strip), false, label);
      stop();
    });
  }
});

test('a 404 (no events route on this server) pauses the events read for 30 minutes', async () => {
  document.body.replaceChildren();
  const realFetch = globalThis.fetch;
  const requests = [];
  let clock = Date.parse('2026-11-18T01:50:00Z');
  let status = 503;
  globalThis.fetch = async (url) => {
    requests.push(url);
    return {
      ok: status === 200,
      status,
      json: async () => ({ ...eventsData, generatedAt: clock }),
    };
  };
  try {
    await withTicks(async (tick) => {
      const stop = installCountyTicker({
        now: () => clock,
        fetchSource: fetchAll,
        fetchFuel: async () => envelopes.fuel,
      });
      await settle();
      const strip = document.getElementById('gev-county-ticker');
      assert.equal(requests.length, 1);
      assert.equal(strip.dataset.events, 'failed');
      assert.equal(strip.querySelectorAll('.gev-ticker-item').length, 6);

      // Any other failure is asked again on the next refresh.
      status = 404;
      clock += 2 * 60 * 1000;
      await tick();
      assert.equal(requests.length, 2, 'a 503 does not pause');
      assert.equal(strip.dataset.events, 'missing');
      assert.match(strip.textContent, /TIDE\s+1\.6 ft/, 'the rest still shows');
      assert.equal(hasLatest(strip), false);

      for (const minutes of [2, 2, 25]) {
        clock += minutes * 60 * 1000;
        await tick();
        assert.equal(requests.length, 2, 'not asked again within 30 minutes');
      }
      assert.match(strip.textContent, /GAS\s+\$4\.06/, 'the rest refreshes');

      // 30 minutes after the 404: asked again (the route may be deployed).
      status = 200;
      clock += 1 * 60 * 1000;
      await tick();
      assert.equal(requests.length, 3);
      assert.equal(requests[2], '/api/local/events', 'still no ?since= yet');
      assert.equal(strip.dataset.events, 'ok');
      assert.equal(hasLatest(strip), true, 'LATEST is back (fire 40 min ago)');
      stop();
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an injected events reader that rejects with status 404 is paused too', async () => {
  document.body.replaceChildren();
  let clock = Date.parse('2026-11-18T01:50:00Z');
  let calls = 0;
  await withTicks(async (tick) => {
    const stop = installCountyTicker({
      now: () => clock,
      fetchSource: fetchAll,
      fetchFuel: async () => envelopes.fuel,
      fetchEvents: async () => {
        calls += 1;
        throw Object.assign(new Error('Events HTTP 404'), { status: 404 });
      },
    });
    await settle();
    clock += 2 * 60 * 1000;
    await tick();
    assert.equal(calls, 1);
    clock += 30 * 60 * 1000;
    await tick();
    assert.equal(calls, 2);
    stop();
  });
});

const groundStop = {
  ...fireEvent,
  id: 'airport:faa:KACY:gs#new',
  key: 'airport:faa:KACY:gs',
  kind: 'airport',
  title: 'Ground stop',
  place: 'Atlantic City (KACY)',
  detail: '',
  lat: null,
  lon: null,
  layer: null,
  severity: 'watch',
  source: 'FAA NAS status',
  threadId: 'airport:faa:KACY:gs#new',
};

test('LATEST for an event with no layer never switches some other layer on', async () => {
  for (const withOpenEvent of [false, true]) {
    document.body.replaceChildren();
    const enabled = new Set();
    const opened = [];
    const stop = installCountyTicker({
      dataManager: {
        isEnabled: (id) => enabled.has(id),
        setEnabled: (id, on) => (on ? enabled.add(id) : enabled.delete(id)),
      },
      now: () => Date.parse('2026-11-18T02:00:00Z'),
      fetchSource: fetchAll,
      fetchFuel: async () => envelopes.fuel,
      fetchEvents: async () => ({ ...eventsData, events: [groundStop] }),
      ...(withOpenEvent ? { openEvent: (id) => opened.push(id) } : {}),
    });
    await settle();
    const latest = document.querySelector(
      '#gev-county-ticker [data-key="events"]',
    );
    assert.ok(latest);
    assert.match(latest.textContent, /Ground stop · Atlantic City \(KACY\)/);
    assert.equal(latest.hasAttribute('data-layer-id'), false, 'no stand-in');
    latest.querySelector('.gev-ticker-label').click();
    assert.equal(enabled.size, 0, 'no layer switched on');
    assert.deepEqual(
      opened,
      withOpenEvent ? [groundStop.id] : [],
      'openEvent, when given, opens it',
    );
    stop();
  }
});

test('with no openEvent, LATEST falls back to turning its layer on', async () => {
  document.body.replaceChildren();
  const enabled = new Set();
  const stop = installCountyTicker({
    dataManager: {
      isEnabled: (id) => enabled.has(id),
      setEnabled: (id, on) => (on ? enabled.add(id) : enabled.delete(id)),
    },
    now: () => Date.parse('2026-11-18T02:00:00Z'),
    fetchSource: fetchAll,
    fetchFuel: async () => envelopes.fuel,
    fetchEvents: async () => eventsData,
  });
  await settle();
  document.querySelector('#gev-county-ticker [data-key="events"]').click();
  assert.ok(enabled.has('scanner-calls'));
  stop();
});
