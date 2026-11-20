import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DASHBOARD_ITEMS,
  dashboardHtml,
  loadDashboard,
  readDisasters,
  readDrought,
  readFaa,
  readFuel,
  readInternet,
  readOutbreaks,
  readRadiation,
  readSpaceWeather,
} from './countyDashboard.js';

/*
 * The fixtures are trimmed copies of what capemaydispatch.com served on
 * 2026-11-18/19 (the same field names and values; long lists cut to the rows
 * the readers use). Set GEV_LIVE_DIR to a folder of saved *.body files to
 * also run every reader against the full answers.
 */
const LIVE = {
  fuel: {
    fetchedAt: 1795073448750,
    stale: false,
    gnd: {
      response: {
        data: [
          {
            period: '2026-11-16',
            series: 'EMM_EPMR_PTE_R1Y_DPG',
            value: '4.064',
          },
          {
            period: '2026-11-09',
            series: 'EMM_EPMR_PTE_R1Y_DPG',
            value: '4.146',
          },
          {
            period: '2026-11-16',
            series: 'EMD_EPD2D_PTE_R1Y_DPG',
            value: '6.309',
          },
          {
            period: '2026-11-09',
            series: 'EMD_EPD2D_PTE_R1Y_DPG',
            value: '6.412',
          },
        ],
      },
    },
    wfr: {
      response: {
        data: [
          {
            period: '2026-11-16',
            series: 'W_EPD2F_PRS_SNJ_DPG',
            value: '5.854',
          },
          {
            period: '2026-11-09',
            series: 'W_EPD2F_PRS_SNJ_DPG',
            value: '6.052',
          },
        ],
      },
    },
  },
  faa: {
    fetchedAt: 1794994551150,
    stale: false,
    ttlMs: 120000,
    updateTime: 'Wed Nov 18 09:35:12 2026 GMT',
    updateTimeMs: 1794994512000,
    local: [],
    nationwide: {
      groundStop: 0,
      groundDelay: 0,
      closure: 5,
      arrivalDepartureDelay: 0,
    },
    totalAirports: 5,
  },
  spaceWeather: {
    fetchedAt: 1794994566335,
    stale: false,
    kpMinute: [
      {
        time_tag: '2026-11-18T09:32:00',
        kp_index: 0,
        estimated_kp: 0.33,
        kp: '0P',
      },
      {
        time_tag: '2026-11-18T09:33:00',
        kp_index: 0,
        estimated_kp: 0.33,
        kp: '0P',
      },
    ],
    kpForecast: [
      { time_tag: '2026-11-19T00:00:00', kp: 2.33, observed: 'predicted' },
      { time_tag: '2026-11-19T03:00:00', kp: 2.67, observed: 'predicted' },
      { time_tag: '2026-11-20T03:00:00', kp: 3.33, observed: 'predicted' },
      { time_tag: '2026-11-21T00:00:00', kp: 3, observed: 'predicted' },
    ],
  },
  drought: {
    fetchedAt: 1794978480081,
    releasedAt: 'Thu, 12 Nov 2026 11:15:51 GMT',
    stale: false,
    ttlMs: 86400000,
    category: 0,
    categories: [
      { point: { lat: 39.08, lon: -74.9 }, category: 0 },
      { point: { lat: 39.3, lon: -75.05 }, category: null },
      { point: { lat: 39.15, lon: -74.82 }, category: 0 },
    ],
  },
  radiation: {
    fetchedAt: 1794994618892,
    stale: false,
    ttlMs: 3600000,
    monitors: [
      {
        key: 'philadelphia',
        name: 'Philadelphia',
        state: 'PA',
        lat: 39.9526,
        lon: -75.1652,
        distanceKm: 101,
        doseRateNSvH: 42,
        gammaCpmR02: 1574,
        sampleTime: '2026-11-18T08:40:00.000Z',
        status: 'APPROVED',
      },
      {
        key: 'edison',
        name: 'Edison',
        state: 'NJ',
        lat: 40.5187,
        lon: -74.4121,
        distanceKm: 163,
        doseRateNSvH: 42,
        gammaCpmR02: 1462,
        sampleTime: '2026-11-18T08:44:00.000Z',
        status: 'APPROVED',
      },
    ],
  },
  internet: {
    fetchedAt: 1794994620527,
    stale: false,
    sources: {
      usSummary: { ok: true, count: 0 },
      njSummary: { ok: true, count: 0 },
      alerts: { ok: true, count: 20 },
    },
    usSummary: [],
    njSummary: [],
    // 20 BGP alerts worldwide, as served; only the count is read.
    alerts: Array.from({ length: 20 }, (_, i) => ({
      datasource: 'bgp',
      entity: { code: String(9202 + i), type: 'asn' },
      level: 'normal',
    })),
  },
  outbreaks: {
    fetchedAt: 1794994611702,
    stale: false,
    ttlMs: 86400000,
    arbonet: {
      ok: false,
      asOf: null,
      status: 'preliminary',
      states: [],
      njCounties: [],
    },
    don: {
      ok: true,
      items: [
        {
          id: 'DON627',
          title: 'Chikungunya virus disease - Switzerland',
          date: '17 November 2026',
          dateIso: '2026-11-17T05:00:00.000Z',
          url: 'https://www.who.int/2026-DON627',
        },
        {
          id: 'DON626',
          title: 'Middle East respiratory syndrome (MERS) – Qatar',
          date: '13 November 2026',
          dateIso: '2026-11-13T05:00:00.000Z',
          url: 'https://www.who.int/2026-DON626',
        },
      ],
    },
  },
  disasters: {
    fetchedAt: 1794994621198,
    stale: false,
    ttlMs: 86400000,
    fema: {
      metadata: { entityname: 'DisasterDeclarationsSummaries', top: 100 },
      DisasterDeclarationsSummaries: [
        ['2021-09-05', 'REMNANTS OF HURRICANE IDA', 'Hurricane'],
        ['2021-09-02', 'REMNANTS OF HURRICANE IDA', 'Hurricane'],
        ['2021-04-28', 'SEVERE WINTER STORM AND SNOWSTORM', 'Snowstorm'],
        ['2020-12-11', 'TROPICAL STORM ISAIAS', 'Hurricane'],
        ['2020-03-25', 'COVID-19 PANDEMIC', 'Biological'],
        ['2020-03-13', 'COVID-19', 'Biological'],
        ['2016-03-14', 'SEVERE WINTER STORM AND SNOWSTORM', 'Severe Storm'],
        ['2012-10-30', 'HURRICANE SANDY', 'Hurricane'],
        ['2012-10-28', 'HURRICANE SANDY', 'Hurricane'],
        ['2011-11-30', 'SEVERE STORM', 'Severe Storm'],
        ['2011-08-31', 'HURRICANE IRENE', 'Hurricane'],
        ['2011-08-27', 'HURRICANE IRENE', 'Hurricane'],
        ['2011-02-04', 'SEVERE WINTER STORM AND SNOWSTORM', 'Snowstorm'],
        ['2010-04-02', 'SEVERE STORMS AND FLOODING', 'Severe Storm'],
        ['2010-03-23', 'SEVERE WINTER STORM AND SNOWSTORM', 'Snowstorm'],
        [
          '2009-12-22',
          "SEVERE STORMS AND FLOODING ASSOCIATED WITH TROPICAL DEPRESSION IDA AND A NOR'EAS",
          'Severe Storm',
        ],
        ['2005-09-19', 'HURRICANE KATRINA EVACUATION', 'Hurricane'],
        ['2003-03-20', 'SNOW', 'Snowstorm'],
        ['2001-09-19', 'FIRES AND EXPLOSIONS', 'Fire'],
        ['2000-11-01', 'WEST NILE VIRUS', 'Other'],
        ['1999-09-17', 'HURRICANE FLOYD EMERGENCY DECLARATIONS', 'Hurricane'],
        [
          '1998-03-03',
          'SEVERE WINTER COASTAL STORM, HIGH WINDS, FLOODING',
          'Coastal Storm',
        ],
        ['1996-01-13', 'BLIZZARD OF 96 (SEVERE SNOW STORM)', 'Snowstorm'],
        ['1993-03-17', 'SEVERE BLIZZARD', 'Snowstorm'],
        [
          '1992-12-18',
          'COASTAL STORM, HIGH TIDES, HEAVY RAIN, & FLOODING',
          'Flood',
        ],
        ['1992-03-03', 'SEVERE COASTAL STORM', 'Severe Storm'],
        ['1985-10-15', 'HURRICANE GLORIA', 'Hurricane'],
        ['1984-04-12', 'COASTAL STORMS & FLOODING', 'Flood'],
        ['1980-10-19', 'WATER SHORTAGE', 'Drought'],
        ['1977-02-08', 'ICE CONDITIONS', 'Severe Ice Storm'],
        ['1976-08-21', 'SEVERE STORMS, HIGH WINDS & FLOODING', 'Flood'],
        [
          '1974-12-24',
          'SEVERE STORMS, HIGH WINDS & HIGH TIDES',
          'Coastal Storm',
        ],
        ['1971-09-04', 'HEAVY RAINS & FLOODING', 'Flood'],
        ['1965-08-18', 'WATER SHORTAGE', 'Drought'],
      ].map(([date, title, type]) => ({
        declarationDate: `${date}T00:00:00.000Z`,
        declarationTitle: title,
        incidentType: type,
      })),
    },
  },
};

const BODY_BY_ENDPOINT = {
  '/api/fuel': LIVE.fuel,
  '/api/faa-status': LIVE.faa,
  '/api/space-weather': LIVE.spaceWeather,
  '/api/drought': LIVE.drought,
  '/api/radiation': LIVE.radiation,
  '/api/internet-outages': LIVE.internet,
  '/api/outbreaks': LIVE.outbreaks,
  '/api/disaster-history': LIVE.disasters,
};

/** The fuel answer was fetched 2026-11-19 07:30 UTC. */
const NOW = Date.parse('2026-11-19T12:00:00Z');

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// ------------------------------------------------------------- the readers

test('gas: the Mid-Atlantic weekly price with diesel and NJ heating oil', () => {
  const r = readFuel(LIVE.fuel, NOW);
  assert.equal(r.value, '$4.06');
  assert.equal(
    r.detail,
    'regular, Mid-Atlantic weekly average · diesel $6.31 · NJ heating oil $5.85 · week of Nov 16',
  );
  assert.equal(r.tone, 'ok');
});

test('gas: an old week says so and goes muted, never shown as current', () => {
  const r = readFuel(LIVE.fuel, Date.parse('2026-12-20T12:00:00Z'));
  assert.equal(r.value, '$4.06');
  assert.match(r.detail, /week of Nov 16, not current$/);
  assert.equal(r.tone, 'muted');
});

test('gas: no gasoline series is no reading', () => {
  assert.equal(readFuel(null, NOW), null);
  assert.equal(readFuel({}, NOW), null);
  assert.equal(readFuel({ gnd: { response: { data: [] } } }, NOW), null);
  // Only heating oil: no gas price to show.
  assert.equal(readFuel({ wfr: LIVE.fuel.wfr }, NOW), null);
});

test('FAA: no local delays reads KACY, KPHL, KEWR with the nationwide counts', () => {
  const r = readFaa(LIVE.faa);
  assert.equal(r.value, 'KACY, KPHL, KEWR: no delays');
  assert.equal(
    r.detail,
    'nationwide: 0 ground stops · 0 ground delay programs · 5 closures · 0 airports with arrival/departure delays',
  );
  assert.equal(r.tone, 'ok');
});

test('FAA: local programs use ICAO ids and FAA terms', () => {
  const stop = readFaa({
    ...LIVE.faa,
    local: [
      {
        airport: 'ACY',
        category: 'ground-stop',
        endTime: '9:45 pm EST',
        reason: 'WEATHER / THUNDERSTORMS',
      },
    ],
    nationwide: { ...LIVE.faa.nationwide, groundStop: 1 },
  });
  assert.equal(
    stop.value,
    'KACY ground stop until 9:45 pm EST (weather / thunderstorms)',
  );
  assert.match(stop.detail, /1 ground stop ·/);
  assert.equal(stop.tone, 'warn');

  const delays = readFaa({
    ...LIVE.faa,
    local: [
      {
        airport: 'PHL',
        category: 'arrival-departure',
        delayType: 'Departure',
        avg: '16 minutes',
        max: '30 minutes',
        reason: 'VOL',
      },
      {
        airport: 'EWR',
        category: 'ground-delay',
        avg: '1 hour and 5 minutes',
        reason: 'WEATHER',
      },
      {
        airport: 'PHL',
        category: 'closure',
        reason: 'never shown: two at most',
      },
    ],
  });
  assert.equal(
    delays.value,
    'KPHL departure delays 16 minutes to 30 minutes (vol); KEWR ground delay program, avg delay 1 hour and 5 minutes (weather)',
  );
  // A closure among the local events (even the third) is a warning.
  assert.equal(delays.tone, 'warn');

  const gdp = readFaa({
    ...LIVE.faa,
    local: [{ airport: 'EWR', category: 'ground-delay', avg: '45 minutes' }],
  });
  assert.equal(gdp.tone, 'watch');
});

test('FAA: an answer without nationwide counts is no reading', () => {
  assert.equal(readFaa(null), null);
  assert.equal(readFaa({ local: [] }), null);
});

test('space weather: Kp from the latest minute, the forecast peak, and the G scale', () => {
  const r = readSpaceWeather(LIVE.spaceWeather);
  assert.equal(r.value, 'Kp 0.3');
  assert.equal(
    r.detail,
    'quiet · forecast peak Kp 3.3 · Kp 5+ can degrade GPS and HF radio',
  );
  assert.equal(r.tone, 'ok');
  const at = (kp) =>
    readSpaceWeather({ kpMinute: [{ estimated_kp: kp }], kpForecast: [] });
  assert.deepEqual(
    [4, 4.67, 5, 6, 7.33, 8, 9].map((kp) => [
      at(kp).detail.split(' · ')[0],
      at(kp).tone,
    ]),
    [
      ['active', 'watch'],
      ['active', 'watch'],
      ['G1 minor storm', 'watch'],
      ['G2 moderate storm', 'warn'],
      ['G3 strong storm', 'warn'],
      ['G4 severe storm', 'danger'],
      ['G5 extreme storm', 'danger'],
    ],
  );
  // kp_index stands in when the estimate is missing; no forecast, no peak.
  assert.equal(
    readSpaceWeather({ kpMinute: [{ kp_index: 2 }] }).detail,
    'quiet · Kp 5+ can degrade GPS and HF radio',
  );
});

test('space weather: missing or invalid Kp is no reading', () => {
  assert.equal(readSpaceWeather(null), null);
  assert.equal(readSpaceWeather({ kpMinute: [] }), null);
  assert.equal(readSpaceWeather({ kpMinute: [{ estimated_kp: 'x' }] }), null);
  assert.equal(readSpaceWeather({ kpMinute: [{ estimated_kp: -1 }] }), null);
});

test('drought: the county category with the map release date (Eastern)', () => {
  assert.deepEqual(readDrought(LIVE.drought), {
    value: 'D0',
    detail: 'abnormally dry · map released Nov 12',
    tone: 'ok',
  });
  assert.deepEqual(readDrought({ category: null }), {
    value: 'None',
    detail: 'no drought in the county',
    tone: 'ok',
  });
  assert.equal(readDrought({ category: 1 }).tone, 'watch');
  assert.deepEqual(readDrought({ category: 3 }), {
    value: 'D3',
    detail: 'extreme drought',
    tone: 'warn',
  });
  assert.equal(readDrought(null), null);
  assert.equal(readDrought({ stale: true }), null);
});

test('radiation: the nearest monitor, labelled regional background', () => {
  assert.deepEqual(readRadiation(LIVE.radiation), {
    value: '42 nSv/h',
    detail:
      'Philadelphia, PA monitor (63 mi away) · regional background, not a county reading',
    tone: 'ok',
  });
  assert.equal(readRadiation({ monitors: [] }), null);
  assert.equal(
    readRadiation({ monitors: [{ name: 'X', doseRateNSvH: null }] }),
    null,
  );
  assert.equal(
    readRadiation({ monitors: [{ name: 'X', doseRateNSvH: '' }] }),
    null,
  );
  assert.equal(readRadiation(null), null);
});

test('internet outages: New Jersey first, then U.S. and worldwide counts', () => {
  assert.deepEqual(readInternet(LIVE.internet), {
    value: 'No NJ outages',
    detail: 'U.S.: none · 20 alerts worldwide',
    tone: 'ok',
  });
  const busy = readInternet({
    ...LIVE.internet,
    njSummary: [{}, {}],
    usSummary: [{}],
    alerts: [{}],
  });
  assert.equal(busy.value, '2 NJ outage events');
  assert.equal(busy.detail, 'U.S.: 1 outage event · 1 alert worldwide');
  assert.equal(busy.tone, 'watch');
  // A failed U.S. half is left out, never shown as "none".
  const noUs = readInternet({
    ...LIVE.internet,
    sources: { ...LIVE.internet.sources, usSummary: { ok: false } },
  });
  assert.equal(noUs.detail, '20 alerts worldwide');
  // A failed New Jersey half is no reading.
  assert.equal(
    readInternet({
      ...LIVE.internet,
      sources: { ...LIVE.internet.sources, njSummary: { ok: false } },
    }),
    null,
  );
  assert.equal(readInternet({}), null);
});

test('outbreaks: a failed CDC read says unavailable, never "none"', () => {
  assert.deepEqual(readOutbreaks(LIVE.outbreaks), {
    value: 'CDC county data unavailable',
    detail: 'latest WHO notice: Chikungunya virus disease - Switzerland',
    tone: 'muted',
  });
});

test('outbreaks: Cape May County rows match by FIPS code', () => {
  const cdc = (njCounties) =>
    readOutbreaks({
      ...LIVE.outbreaks,
      arbonet: {
        ok: true,
        asOf: 'November 11, 2026',
        status: 'preliminary',
        njCounties,
      },
    });
  const cases = cdc([
    { fips: '34001', humanCases: 4 },
    { fips: '34009', humanCases: 2 },
  ]);
  assert.equal(cases.value, '2 human West Nile cases in the county');
  assert.equal(
    cases.detail,
    'latest WHO notice: Chikungunya virus disease - Switzerland · CDC as of November 11, 2026',
  );
  assert.equal(cases.tone, 'watch');
  assert.equal(
    cdc([{ fips: '34009', humanCases: 1 }]).value,
    '1 human West Nile case in the county',
  );
  assert.equal(cdc([{ fips: '34009', humanCases: 0 }]).tone, 'ok');
  const none = cdc([{ fips: '34001', humanCases: 4 }]);
  assert.equal(none.value, 'No county West Nile activity listed');
  assert.equal(none.tone, 'ok');
});

test('outbreaks: a failed WHO read says so; both failed is no reading', () => {
  const noWho = readOutbreaks({
    ...LIVE.outbreaks,
    arbonet: { ok: true, asOf: null, njCounties: [] },
    don: { ok: false, items: [] },
  });
  assert.equal(noWho.detail, 'WHO notices unavailable');
  const quietWho = readOutbreaks({
    ...LIVE.outbreaks,
    arbonet: { ok: true, asOf: null, njCounties: [] },
    don: { ok: true, items: [] },
  });
  assert.equal(quietWho.detail, 'no WHO notices');
  assert.equal(
    readOutbreaks({ arbonet: { ok: false }, don: { ok: false, items: [] } }),
    null,
  );
  assert.equal(readOutbreaks(null), null);
});

test('disaster history: the count since the first year and the latest, in title case', () => {
  assert.deepEqual(readDisasters(LIVE.disasters), {
    value: '34 federal declarations since 1965',
    detail: 'latest: Remnants of Hurricane Ida (2021)',
    tone: 'ok',
  });
  assert.equal(
    readDisasters({ fema: { DisasterDeclarationsSummaries: [] } }),
    null,
  );
  assert.equal(readDisasters({ fema: null }), null);
  assert.equal(readDisasters(null), null);
  // No title: the incident type stands in.
  assert.equal(
    readDisasters({
      fema: {
        rows: [{ declarationDate: '2024-01-10', incidentType: 'FLOOD' }],
      },
    }).detail,
    'latest: Flood (2024)',
  );
});

// -------------------------------------------------------- load and render

test('loadDashboard reads every card from its own endpoint, same-origin', async () => {
  const asked = [];
  const items = await loadDashboard({
    fetchImpl: async (url, options) => {
      asked.push([url, options.credentials]);
      return jsonResponse(BODY_BY_ENDPOINT[url]);
    },
  });
  assert.deepEqual(
    asked.map(([url]) => url),
    DASHBOARD_ITEMS.map((item) => item.endpoint),
  );
  assert.ok(asked.every(([, credentials]) => credentials === 'same-origin'));
  assert.deepEqual(
    items.map((item) => item.id),
    [
      'fuel-prices',
      'faa-status',
      'space-weather',
      'drought',
      'radiation',
      'internet-outages',
      'outbreaks',
      'disaster-history',
    ],
  );
  for (const item of items) {
    assert.ok(item.reading?.value, item.id);
    assert.ok(Number.isFinite(item.fetchedAt), item.id);
    assert.equal(item.stale, false, item.id);
  }
  assert.equal(items[0].fetchedAt, LIVE.fuel.fetchedAt);
});

test('loadDashboard: each failing card is "no reading" and the rest still load', async () => {
  const items = await loadDashboard({
    fetchImpl: async (url) => {
      if (url === '/api/fuel') return jsonResponse({}, 503);
      if (url === '/api/faa-status') throw new Error('offline');
      if (url === '/api/drought')
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError('not JSON');
          },
        };
      if (url === '/api/radiation') return null;
      // A cached answer the server marks stale, with an impossible time.
      if (url === '/api/space-weather')
        return jsonResponse({
          ...LIVE.spaceWeather,
          stale: true,
          fetchedAt: 1e20,
        });
      return jsonResponse(BODY_BY_ENDPOINT[url]);
    },
  });
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  for (const id of ['fuel-prices', 'faa-status', 'drought', 'radiation']) {
    assert.equal(byId[id].reading, null, id);
    assert.equal(byId[id].fetchedAt, null, id);
  }
  assert.equal(byId['space-weather'].stale, true);
  assert.equal(byId['space-weather'].fetchedAt, null);
  assert.equal(
    byId['disaster-history'].reading.value,
    '34 federal declarations since 1965',
  );
  // An impossible time never reaches the clock formatter.
  assert.doesNotThrow(() => dashboardHtml(items, { now: NOW }));
});

test('loadDashboard never throws, even when fetch itself is missing', async () => {
  const items = await loadDashboard({
    fetchImpl: () => {
      throw new TypeError('fetch is not a function');
    },
  });
  assert.equal(items.length, DASHBOARD_ITEMS.length);
  assert.ok(items.every((item) => item.reading === null));
});

test('dashboardHtml: every card names its source and fetch time (Eastern) and carries its switch', async () => {
  const items = await loadDashboard({
    fetchImpl: async (url) => jsonResponse(BODY_BY_ENDPOINT[url]),
  });
  const toggles = [];
  const html = dashboardHtml(items, {
    now: NOW,
    toggle: (id, title) => {
      toggles.push([id, title]);
      return `<button data-act="layer" data-layer="${id}">Show on map</button>`;
    },
  });
  assert.equal(html.match(/class="gev-dash-card /g).length, 8);
  assert.deepEqual(
    toggles,
    DASHBOARD_ITEMS.map((item) => [item.id, item.title]),
  );
  assert.match(html, /data-layer="faa-status"/);
  assert.match(html, /<strong class="gev-dash-value">\$4\.06<\/strong>/);
  assert.match(
    html,
    /Source: FAA NAS Status · fetched 4:35\sAM EST \(\d+ h ago\)/,
  );
  assert.match(html, /Source: U\.S\. EIA · fetched 2:30\sAM EST \(4 h ago\)/);
  assert.match(html, /Source: OpenFEMA/);
  assert.match(html, /class="gev-dash-card tone-ok"/);
  assert.match(html, /class="gev-dash-card tone-muted"/); // outbreaks: CDC failed
});

test('dashboardHtml: no reading says so, stale says not current, both muted', () => {
  const [fuel, faa] = DASHBOARD_ITEMS;
  const html = dashboardHtml(
    [
      { ...fuel, reading: null, fetchedAt: null, stale: false },
      {
        ...faa,
        reading: {
          value: 'KACY, KPHL, KEWR: no delays',
          detail: 'x',
          tone: 'ok',
        },
        fetchedAt: NOW - 60 * 60_000,
        stale: true,
      },
    ],
    { now: NOW },
  );
  assert.match(html, /<strong class="gev-dash-value">No reading<\/strong>/);
  assert.match(
    html,
    /The source did not answer\. Try again in a few minutes\./,
  );
  assert.match(html, /Source: U\.S\. EIA<\/small>/);
  assert.match(html, /fetched 6:00\sAM EST \(1 h ago\) · not current/);
  assert.equal(html.match(/tone-muted/g).length, 2);
  assert.doesNotMatch(html, /tone-ok/);
});

test('dashboardHtml escapes every text and keeps tones to a known set', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const html = dashboardHtml(
    [
      {
        id: 'fuel-prices',
        title: evil,
        source: evil,
        reading: { value: evil, detail: evil, tone: 'ok" onclick="x' },
        fetchedAt: NOW,
        stale: false,
      },
    ],
    { now: NOW },
  );
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onclick/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
  assert.match(html, /class="gev-dash-card tone-muted"/);
  assert.equal(dashboardHtml(null), '<div class="gev-dash"></div>');
});

// Opt-in: GEV_LIVE_DIR=/path/to/saved/bodies runs the readers on the full
// answers the site served (fuel-api.body, faa-status.body, ...).
const LIVE_DIR = process.env.GEV_LIVE_DIR || '';
test(
  'the readers give the same readings on the full saved answers',
  { skip: !LIVE_DIR || !existsSync(path.join(LIVE_DIR, 'fuel-api.body')) },
  () => {
    const body = (name) =>
      JSON.parse(readFileSync(path.join(LIVE_DIR, `${name}.body`), 'utf8'));
    assert.deepEqual(readFuel(body('fuel-api'), NOW), readFuel(LIVE.fuel, NOW));
    assert.deepEqual(readFaa(body('faa-status')), readFaa(LIVE.faa));
    assert.deepEqual(
      readSpaceWeather(body('space-weather')),
      readSpaceWeather(LIVE.spaceWeather),
    );
    assert.deepEqual(readDrought(body('drought')), readDrought(LIVE.drought));
    assert.deepEqual(
      readRadiation(body('radiation')),
      readRadiation(LIVE.radiation),
    );
    assert.deepEqual(
      readInternet(body('internet-outages')),
      readInternet(LIVE.internet),
    );
    assert.deepEqual(
      readOutbreaks(body('outbreaks')),
      readOutbreaks(LIVE.outbreaks),
    );
    assert.deepEqual(
      readDisasters(body('disaster-history')),
      readDisasters(LIVE.disasters),
    );
  },
);
