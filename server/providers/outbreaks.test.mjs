// server/providers/outbreaks.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CDC_WNV_CSV_BASE,
  OUTBREAKS_PROXY_TTL_MS,
  OUTBREAKS_PROXY_USER_AGENT,
  extractCdcAsOfDate,
  normalizeWhoDonItem,
  outbreaksProxy,
  outbreaksUpstreamUrl,
  parseCountByStateCsv,
  parseHumNonhumCsv,
} from './outbreaks.js';

const T0 = 1_793_123_456_789;

// Verbatim live CDC dashboard datasets entry (trimmed to the two CSVs the
// layer uses, plus one unrelated file to prove suffix selection).
const DASHBOARD_JSON = {
  datasets: {
    'https://www.cdc.gov/wcms/vizdata/live/ncezid_dvbd/WNV/wnv_hum_current_CountbyState.csv': {
      dataFileSize: 562,
      dataFileFormat: 'CSV',
    },
    'https://www.cdc.gov/wcms/vizdata/live/ncezid_dvbd/WNV/wnv_current_hum_nonhum.csv': {
      dataFileSize: 36148,
      dataFileFormat: 'CSV',
    },
    'https://www.cdc.gov/wcms/vizdata/live/ncezid_dvbd/WNV/wnv_total_cases.csv': {
      dataFileSize: 14,
      dataFileFormat: 'CSV',
    },
  },
};

// Verbatim live CSV rows from 2026-11-17.
const COUNT_BY_STATE_CSV = `"State","Reported Cases","Legend"
AL,25,9 to 25
CA,527,>25
NJ,35,>25
`;
const HUM_NONHUM_CSV = `"County","Activity","Total human disease cases","Neuroinvasive disease cases","Presumptive viremic blood donors"
01001,Human infections,1,1,0
34001,Human infections and non-human activity,2,2,0
34007,Human infections and non-human activity,6,4,2
34009,Non-human activity,0,0,0
`;

// The CDC page splits the as-of date across elements.
const CDC_PAGE_HTML = `<p>Data are current as of <span>November 10</span>, <span>2026</span>.</p>`;

// Verbatim live WHO DON items from 2026-11-17 (OData feed).
const WHO_DON_JSON = {
  '@odata.context': 'https://www.who.int/api/$metadata#diseaseoutbreaknews',
  value: [
    {
      ItemDefaultUrl: '/2026-DON626',
      PublicationDateAndTime: '2026-11-13T19:00:00Z',
      Title: 'Middle East respiratory syndrome (MERS) – Qatar',
      OverrideTitle: 'Middle East respiratory syndrome (MERS) – Qatar',
      UseOverrideTitle: true,
      FormattedDate: '13 November 2026',
    },
    {
      ItemDefaultUrl: '/2026-DON625',
      PublicationDateAndTime: '2026-11-06T20:42:12Z',
      Title:
        'Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo, Kenya and Nigeria',
      OverrideTitle:
        'Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo, Kenya and Nigeria',
      UseOverrideTitle: true,
      FormattedDate: '6 November 2026',
    },
  ],
  '@odata.nextLink': 'diseaseoutbreaknews?$skip=50',
};

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = outbreaksProxy({
    fetchImpl,
    now: clock,
    warn: (...args) => warnings.push(args.join(' ')),
  });
  let handler;
  let mountPath;
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        mountPath = path;
        handler = fn;
      },
    },
  });
  const call = async (url) => {
    const res = {
      headersSent: false,
      writeHead(status, headers) {
        res.status = status;
        res.headers = headers;
        res.headersSent = true;
      },
      end(text) {
        res.body = text;
      },
    };
    await handler({ url }, res);
    return {
      status: res.status,
      headers: res.headers,
      body: res.body,
      json: res.body ? JSON.parse(res.body) : null,
    };
  };
  return {
    mountPath,
    call,
    warnings,
    setTime: (ms) => {
      currentTime = ms;
    },
    get time() {
      return currentTime;
    },
  };
}

function stubUpstream(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  return { fetchImpl, calls };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers });

/** Route by upstream: CDC dashboard, CDC CSVs, CDC page, WHO OData. */
function liveUpstream() {
  return stubUpstream(async (url) => {
    if (url.includes('current-data.json')) return json(DASHBOARD_JSON);
    if (url.includes('CountbyState.csv')) return text(COUNT_BY_STATE_CSV);
    if (url.includes('hum_nonhum.csv')) return text(HUM_NONHUM_CSV);
    if (url.includes('current-year-data.html')) return text(CDC_PAGE_HTML);
    if (url.includes('diseaseoutbreaknews')) return json(WHO_DON_JSON);
    return json({ error: 'not found' }, 404);
  });
}

test('the upstream URLs are the CDC dashboard and the WHO OData feed, no key', () => {
  assert.equal(
    outbreaksUpstreamUrl(),
    'https://www.cdc.gov/west-nile-virus/data-maps/current-data.json',
  );
  assert.equal(
    OUTBREAKS_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('one refresh polls both halves: NJ 35, Cape May zero, 2 DONs, as-of date', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const { mountPath, call } = mount({ fetchImpl });
  assert.equal(mountPath, '/api/outbreaks');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, OUTBREAKS_PROXY_TTL_MS);
  assert.equal(res.json.arbonet.ok, true);
  assert.equal(res.json.arbonet.asOf, 'November 10, 2026');
  assert.equal(res.json.arbonet.status, 'preliminary');
  assert.deepEqual(
    res.json.arbonet.states.find((row) => row.state === 'NJ'),
    { state: 'NJ', cases: 35, band: '>25' },
  );
  assert.deepEqual(
    res.json.arbonet.njCounties.find((row) => row.fips === '34009'),
    {
      fips: '34009',
      activity: 'Non-human activity',
      humanCases: 0,
      neuroinvasive: 0,
      donors: 0,
    },
  );
  // Non-NJ counties never ship to the client.
  assert.equal(
    res.json.arbonet.njCounties.some((row) => row.fips === '01001'),
    false,
  );
  assert.equal(res.json.don.ok, true);
  assert.equal(res.json.don.items.length, 2);
  assert.equal(res.json.don.items[0].id, 'DON626');
  assert.equal(
    res.json.don.items[0].title,
    'Middle East respiratory syndrome (MERS) – Qatar',
  );
  // The override title wins over the comma-joined Title.
  assert.equal(
    res.json.don.items[1].title,
    'Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo, Kenya and Nigeria',
  );

  assert.equal(calls.length, 5);
  assert.ok(
    calls.every(
      (c) => c.options.headers['User-Agent'] === OUTBREAKS_PROXY_USER_AGENT,
    ),
  );
  assert.ok(
    calls.every((c) => c.options.headers.Authorization === undefined),
  );

  const status = await call('/status');
  assert.equal(status.json.lastFetch, T0);
  assert.equal(status.json.stale, false);
  assert.deepEqual(status.json.counts, {
    states: 3,
    njCounties: 3,
    don: 2,
  });
  assert.deepEqual(status.json.arbonet, {
    ok: true,
    asOf: 'November 10, 2026',
  });
  assert.deepEqual(status.json.don, { ok: true });
});

test('the CDC dashboard down still serves from the known CSV paths', async () => {
  const { fetchImpl, calls } = stubUpstream(async (url) => {
    if (url.includes('current-data.json')) return json({ error: 'down' }, 500);
    if (url.includes('CountbyState.csv')) return text(COUNT_BY_STATE_CSV);
    if (url.includes('hum_nonhum.csv')) return text(HUM_NONHUM_CSV);
    if (url.includes('current-year-data.html')) return text(CDC_PAGE_HTML);
    if (url.includes('diseaseoutbreaknews')) return json(WHO_DON_JSON);
    return json({ error: 'not found' }, 404);
  });
  const proxy = mount({ fetchImpl });
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.arbonet.ok, true);
  assert.equal(
    res.json.arbonet.states.find((row) => row.state === 'NJ').cases,
    35,
  );
  assert.ok(
    calls.some((c) =>
      c.url.startsWith(`${CDC_WNV_CSV_BASE}/wnv_hum_current_CountbyState.csv`),
    ),
  );
});

test('WHO down still serves the CDC half, marked ok:false', async () => {
  const { fetchImpl } = stubUpstream(async (url) => {
    if (url.includes('diseaseoutbreaknews'))
      return json({ error: 'down' }, 500);
    if (url.includes('current-data.json')) return json(DASHBOARD_JSON);
    if (url.includes('CountbyState.csv')) return text(COUNT_BY_STATE_CSV);
    if (url.includes('hum_nonhum.csv')) return text(HUM_NONHUM_CSV);
    if (url.includes('current-year-data.html')) return text(CDC_PAGE_HTML);
    return json({ error: 'not found' }, 404);
  });
  const proxy = mount({ fetchImpl });
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.arbonet.ok, true);
  assert.equal(res.json.don.ok, false);
  assert.deepEqual(res.json.don.items, []);
});

test('upstream down on both halves with warm cache serves stale; cold → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async (url) => {
    n += 1;
    // First refresh (5 calls) succeeds; every later call fails.
    if (n <= 5) {
      if (url.includes('current-data.json')) return json(DASHBOARD_JSON);
      if (url.includes('CountbyState.csv')) return text(COUNT_BY_STATE_CSV);
      if (url.includes('hum_nonhum.csv')) return text(HUM_NONHUM_CSV);
      if (url.includes('current-year-data.html')) return text(CDC_PAGE_HTML);
      if (url.includes('diseaseoutbreaknews')) return json(WHO_DON_JSON);
    }
    return json({ error: 'down' }, 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl });
  const first = await proxy.call('/');
  assert.equal(first.status, 200);
  proxy.setTime(T0 + OUTBREAKS_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(flaky.calls.length, 10);

  const failing = stubUpstream(async () => json({ error: 'down' }, 500));
  const cold = mount({ fetchImpl: failing.fetchImpl });
  const coldFirst = await cold.call('/');
  assert.equal(coldFirst.status, 502);
  assert.equal(
    coldFirst.json.error,
    'Outbreaks fetch failed and no cache available',
  );
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 5);
  proxy.setTime(T0 + OUTBREAKS_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 10);
});

test('the CSV parsers handle quoted headers and filter to NJ counties', () => {
  assert.deepEqual(parseCountByStateCsv(COUNT_BY_STATE_CSV), [
    { state: 'AL', cases: 25, band: '9 to 25' },
    { state: 'CA', cases: 527, band: '>25' },
    { state: 'NJ', cases: 35, band: '>25' },
  ]);
  assert.deepEqual(parseHumNonhumCsv(HUM_NONHUM_CSV), [
    {
      fips: '34001',
      activity: 'Human infections and non-human activity',
      humanCases: 2,
      neuroinvasive: 2,
      donors: 0,
    },
    {
      fips: '34007',
      activity: 'Human infections and non-human activity',
      humanCases: 6,
      neuroinvasive: 4,
      donors: 2,
    },
    {
      fips: '34009',
      activity: 'Non-human activity',
      humanCases: 0,
      neuroinvasive: 0,
      donors: 0,
    },
  ]);
  assert.deepEqual(parseCountByStateCsv(''), []);
  assert.deepEqual(parseHumNonhumCsv(''), []);
});

test('the as-of extractor tolerates the date split across elements', () => {
  assert.equal(
    extractCdcAsOfDate(CDC_PAGE_HTML),
    'November 10, 2026',
  );
  assert.equal(
    extractCdcAsOfDate('<p>Data are current as of November 10, 2026.</p>'),
    'November 10, 2026',
  );
  assert.equal(extractCdcAsOfDate('<p>No date here.</p>'), null);
  assert.equal(extractCdcAsOfDate(null), null);
});

test('a DON without an id or title is dropped, never half-published', () => {
  assert.equal(
    normalizeWhoDonItem({ ItemDefaultUrl: '/2026-DON626' }),
    null,
  );
  assert.equal(
    normalizeWhoDonItem({
      ItemDefaultUrl: '/2026-DON626',
      Title: 'Middle East respiratory syndrome (MERS) – Qatar',
      FormattedDate: '13 November 2026',
    }).id,
    'DON626',
  );
  assert.equal(normalizeWhoDonItem(null), null);
});
