import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  satnogsProxy,
  trimSatnogsObservation,
  nextPageUrl,
  SATNOGS_OBSERVATIONS_API,
  SATNOGS_DB_API,
  SATNOGS_PROXY_TTL_MS,
  SATNOGS_PROXY_USER_AGENT,
  SATNOGS_MAX_GOOD_PAGES,
  SATNOGS_MAX_FUTURE_PAGES,
} from './satnogs.js';

const T0 = 1_793_123_456_789;

// Verbatim-shaped observations-API rows (live shape, 2026-11-16): one
// good CPSAT pass heard by W2MMD, one future ISS pass, one bad row.
const GOOD_ROW = {
  id: 15449441,
  start: '2026-11-16T05:12:41Z',
  end: '2026-11-16T05:22:03Z',
  ground_station: 223,
  transmitter: 'gdw6vp69VvGqoYrZvFrx7t',
  norad_cat_id: 98194,
  payload:
    'https://network-satnogs.freetls.fastly.net/media/data_obs/2026/11/16/5/15449441/satnogs_15449441_2026-11-16T05-12-41.ogg',
  waterfall:
    'https://s3.eu-central-1.wasabisys.com/satnogs-network/data_obs/2026/11/16/5/15449441/waterfall_15449441_2026-11-16T05-12-41.png',
  demoddata: [{ payload_demod: 'https://example.com/data_1' }],
  station_name: 'W2MMD GCARC Clubhouse',
  station_lat: 39.716,
  station_lng: -75.21,
  station_alt: 10,
  archived: false,
  status: 'good',
  vetted_user: null,
  rise_azimuth: 196.0,
  set_azimuth: 331.0,
  max_altitude: 29.0,
  transmitter_description: 'Mode U - BPSK9k6 - AX.25 G3RUH',
  transmitter_mode: 'BPSK',
  transmitter_downlink_low: 437265000,
  transmitter_downlink_high: 437265000,
  observation_frequency: 437265000,
  tle0: '0 OBJECT B',
  tle1: '1 98194U 26229B   26317.20631711  .00002277  00000-0  20032-3 0  9990',
  tle2: '2 98194  97.6983  52.8177 0008089 334.0336  26.0479 14.97484791  5560',
  tle_source: 'Space-Track.org',
  client_metadata: '{"radio": {"name": "gr-satnogs"}}',
  sat_id: 'AMZY-1477-5767-9442-4222',
};

const FUTURE_ROW = {
  id: 15458254,
  start: '2026-11-17T16:56:41Z',
  end: '2026-11-17T17:06:41Z',
  ground_station: 223,
  norad_cat_id: 98914,
  payload: null,
  waterfall: null,
  demoddata: [],
  station_name: 'W2MMD GCARC Clubhouse',
  station_lat: 39.716,
  station_lng: -75.21,
  status: 'future',
  transmitter_description: null,
  transmitter_mode: null,
  max_altitude: 41.0,
};

const BAD_ROW = { ...GOOD_ROW, id: 15449442, status: 'bad' };

function mount({ fetchImpl, cacheDir } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const dir = cacheDir ?? mkdtempSync(path.join(tmpdir(), 'gev-satnogs-proxy-'));
  const plugin = satnogsProxy({
    fetchImpl,
    now: clock,
    cacheDir: dir,
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
    cacheDir: dir,
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
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * Stub upstream: station 223 returns one good page (good + bad rows),
 * one future page, and a DB name for CPSAT; every other station returns
 * empty pages; unknown NORAD ids resolve to [] (unnamed).
 */
function liveLikeUpstream() {
  return stubUpstream((url) => {
    if (url.startsWith(SATNOGS_DB_API)) {
      const id = new URL(url).searchParams.get('norad_cat_id');
      if (id === '98194')
        return json([{ sat_id: 'AMZY-1477-5767-9442-4222', norad_cat_id: 98194, name: 'CPSAT' }]);
      return json([]);
    }
    if (url.startsWith(SATNOGS_OBSERVATIONS_API)) {
      const params = new URL(url).searchParams;
      const station = params.get('ground_station');
      const status = params.get('status');
      if (station === '223' && status === 'good')
        return json([GOOD_ROW, BAD_ROW]);
      if (station === '223' && status === 'future') return json([FUTURE_ROW]);
      return json([]);
    }
    throw new Error(`unexpected upstream URL ${url}`);
  });
}

test('the proxy targets the documented SatNOGS endpoints', () => {
  assert.equal(
    SATNOGS_OBSERVATIONS_API,
    'https://network.satnogs.org/api/observations/',
  );
  assert.equal(SATNOGS_DB_API, 'https://db.satnogs.org/api/satellites/');
  assert.equal(
    SATNOGS_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
  assert.equal(SATNOGS_MAX_GOOD_PAGES, 6);
  assert.equal(SATNOGS_MAX_FUTURE_PAGES, 2);
});

test('nextPageUrl follows rel=next and ignores the rest', () => {
  assert.equal(
    nextPageUrl(
      '<https://network.satnogs.org/api/observations/?cursor=abc&ground_station=223&status=good>; rel="next"',
    ),
    'https://network.satnogs.org/api/observations/?cursor=abc&ground_station=223&status=good',
  );
  assert.equal(
    nextPageUrl(
      '<https://example.com/prev>; rel="prev", <https://example.com/next>; rel="next"',
    ),
    'https://example.com/next',
  );
  assert.equal(nextPageUrl(null), null);
  assert.equal(nextPageUrl(''), null);
  assert.equal(nextPageUrl('<https://example.com/x>; rel="prev"'), null);
});

test('trimSatnogsObservation drops TLEs and metadata, keeps a demod count', () => {
  const row = trimSatnogsObservation(GOOD_ROW);
  assert.equal(row.id, 15449441);
  assert.equal(row.status, 'good');
  assert.equal(row.demod_count, 1);
  assert.equal(row.satellite_name, null);
  assert.equal(row.station_name, 'W2MMD GCARC Clubhouse');
  assert.equal(row.transmitter_downlink_low, 437265000);
  assert.ok(!('tle0' in row));
  assert.ok(!('tle1' in row));
  assert.ok(!('tle2' in row));
  assert.ok(!('tle_source' in row));
  assert.ok(!('client_metadata' in row));
  assert.ok(!('demoddata' in row));
  assert.ok(!('transmitter' in row));
  assert.equal(trimSatnogsObservation(null), null);
  assert.equal(trimSatnogsObservation({}), null);
  assert.equal(trimSatnogsObservation({ id: 'bogus' }), null);
});

test('all stations merge into one payload with DB-resolved names', async () => {
  const upstream = liveLikeUpstream();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  assert.equal(h.mountPath, '/api/satnogs');
  const res = await h.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, SATNOGS_PROXY_TTL_MS);
  assert.equal(res.json.fetchedAt, T0);
  // 223: good + bad + future; the other three stations: empty pages.
  assert.equal(res.json.count, 3);
  assert.deepEqual(
    res.json.stations.map((station) => [station.id, station.count, station.ok]),
    [
      [223, 3, true],
      [2575, 0, true],
      [4655, 0, true],
      [3610, 0, true],
    ],
  );
  const cpsat = res.json.observations.find((row) => row.id === 15449441);
  assert.equal(cpsat.satellite_name, 'CPSAT');
  // The bad row keeps its upstream status (records.js drops it); the
  // future ISS row has no DB name (stub returns []) so it stays null.
  const iss = res.json.observations.find((row) => row.id === 15458254);
  assert.equal(iss.satellite_name, null);
  assert.equal(iss.status, 'future');
  // 8 observation calls (good + future × 4 stations) + 2 DB lookups.
  assert.equal(
    upstream.calls.filter((call) =>
      call.url.startsWith(SATNOGS_OBSERVATIONS_API),
    ).length,
    8,
  );
  assert.equal(
    upstream.calls.filter((call) => call.url.startsWith(SATNOGS_DB_API))
      .length,
    2,
  );
  for (const call of upstream.calls) {
    assert.equal(
      call.options.headers['User-Agent'],
      SATNOGS_PROXY_USER_AGENT,
    );
  }
  // The refresh is cached to disk (restart-proof), names included.
  assert.ok(existsSync(path.join(h.cacheDir, 'satnogs.json')));
  const cached = JSON.parse(
    readFileSync(path.join(h.cacheDir, 'satnogs.json'), 'utf8'),
  );
  assert.equal(cached.observations.length, 3);
  assert.equal(cached.names['98194'], 'CPSAT');
});

test('cursor pagination is followed up to the page cap', async () => {
  const upstream = stubUpstream((url) => {
    if (url.startsWith(SATNOGS_DB_API)) return json([]);
    const params = new URL(url).searchParams;
    if (params.get('ground_station') === '223' && params.get('status') === 'good') {
      if (!params.has('cursor')) {
        const next = `${SATNOGS_OBSERVATIONS_API}?cursor=page2&ground_station=223&status=good`;
        return json([GOOD_ROW], 200, { Link: `<${next}>; rel="next"` });
      }
      return json([{ ...GOOD_ROW, id: 15449443 }]);
    }
    return json([]);
  });
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const res = await h.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.count, 2);
  assert.deepEqual(
    res.json.observations
      .filter((row) => row.ground_station === 223)
      .map((row) => row.id)
      .sort(),
    [15449441, 15449443],
  );
});

test('fresh cache serves without an upstream call; stale cache refreshes', async () => {
  const upstream = liveLikeUpstream();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  await h.call('/');
  const firstCalls = upstream.calls.length;
  await h.call('/');
  assert.equal(upstream.calls.length, firstCalls); // served from memory
  h.setTime(T0 + SATNOGS_PROXY_TTL_MS + 1);
  await h.call('/');
  assert.ok(upstream.calls.length > firstCalls); // TTL passed: one refresh
});

test('concurrent requests share one upstream refresh (single-flight)', async () => {
  const resolvers = [];
  const upstream = stubUpstream(
    () =>
      new Promise((done) => {
        resolvers.push(done);
      }),
  );
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const first = h.call('/');
  const second = h.call('/');
  // Let both handlers reach the shared inflight promise.
  await new Promise((done) => setImmediate(done));
  // Each station's good+future calls hang until released; resolve them
  // all with empty pages — two waves (good, then future).
  for (const resolveFetch of resolvers.splice(0)) resolveFetch(json([]));
  await new Promise((done) => setImmediate(done));
  for (const resolveFetch of resolvers.splice(0)) resolveFetch(json([]));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  // 4 stations × (good + future), one refresh pass: exactly 8 calls.
  assert.equal(upstream.calls.length, 8);
});

test('one station down still serves the others, marked ok:false', async () => {
  const upstream = stubUpstream((url) => {
    if (url.startsWith(SATNOGS_DB_API)) return json([]);
    const params = new URL(url).searchParams;
    if (params.get('ground_station') === '223')
      return new Response('Bad Gateway', { status: 502 });
    return json([]);
  });
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const res = await h.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.count, 0);
  assert.deepEqual(
    res.json.stations.map((station) => [station.id, station.ok]),
    [
      [223, false],
      [2575, true],
      [4655, true],
      [3610, true],
    ],
  );
  assert.match(h.warnings.join(' '), /station 223 fetch failed/);
});

test('all stations down serves stale cache, else 502', async () => {
  const failing = stubUpstream(
    () => new Response('Bad Gateway', { status: 502 }),
  );
  const h = mount({ fetchImpl: failing.fetchImpl });
  const cold = await h.call('/');
  assert.equal(cold.status, 502);
  assert.equal(
    cold.json.error,
    'SatNOGS fetch failed and no cache available',
  );

  // Warm the cache, then take every station down.
  const upstream = liveLikeUpstream();
  const warm = mount({ fetchImpl: upstream.fetchImpl, cacheDir: h.cacheDir });
  await warm.call('/');
  const stale = mount({ fetchImpl: failing.fetchImpl, cacheDir: h.cacheDir });
  stale.setTime(T0 + SATNOGS_PROXY_TTL_MS + 1);
  const res = await stale.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, true);
  assert.equal(res.json.count, 3);
});

test('status reports last fetch, count, staleness, and stations', async () => {
  const upstream = liveLikeUpstream();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const before = await h.call('/status');
  assert.deepEqual(before.json, {
    lastFetch: null,
    count: null,
    stale: false,
    ttlMs: SATNOGS_PROXY_TTL_MS,
    stations: null,
  });
  await h.call('/');
  const after = await h.call('/status');
  assert.equal(after.json.lastFetch, T0);
  assert.equal(after.json.count, 3);
  assert.equal(after.json.stale, false);
  assert.equal(after.json.stations.length, 4);
  h.setTime(T0 + SATNOGS_PROXY_TTL_MS + 1);
  const stale = await h.call('/status');
  assert.equal(stale.json.stale, true);
});

test('oversized and non-list upstream bodies fail the station, not the server', async () => {
  const huge = stubUpstream(
    () => new Response('x'.repeat(3 * 1024 * 1024), { status: 200 }),
  );
  const h = mount({ fetchImpl: huge.fetchImpl });
  const res = await h.call('/');
  assert.equal(res.status, 502);
  const notList = stubUpstream(() => json({ detail: 'nope' }));
  const h2 = mount({ fetchImpl: notList.fetchImpl });
  const res2 = await h2.call('/');
  assert.equal(res2.status, 502);
});

test('a disk cache from a previous process serves without upstream', async () => {
  const upstream = liveLikeUpstream();
  const first = mount({ fetchImpl: upstream.fetchImpl });
  await first.call('/');
  assert.ok(upstream.calls.length > 0);
  const second = mount({
    fetchImpl: async () => {
      throw new Error('upstream must not be called');
    },
    cacheDir: first.cacheDir,
  });
  const res = await second.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.count, 3);
});
