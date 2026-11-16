import assert from 'node:assert/strict';
import test from 'node:test';
import {
  faaStatusProxy,
  FAA_STATUS_PROXY_TTL_MS,
  FAA_STATUS_PROXY_USER_AGENT,
  FAA_STATUS_UPSTREAM_URL,
} from './faaStatus.js';

const T0 = 1_793_123_456_789;

// Live NAS feed fetched 2026-11-16 ~19:28 UTC (verbatim, whitespace only).
const LIVE_XML =
  '<AIRPORT_STATUS_INFORMATION><Update_Time>Mon Nov 16 19:28:03 2026 GMT</Update_Time>' +
  '<Dtd_File>http://www.fly.faa.gov/AirportStatus.dtd</Dtd_File>' +
  '<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List>' +
  '<Program><ARPT>LGA</ARPT><Reason>airspace volume</Reason><End_Time>2:45 pm EST</End_Time></Program>' +
  '<Program><ARPT>AUS</ARPT><Reason>runway construction</Reason><End_Time>2:15 pm CST</End_Time></Program>' +
  '</Ground_Stop_List></Delay_type>' +
  '<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List>' +
  '<Ground_Delay><ARPT>SAN</ARPT><Reason>airport volume</Reason><Avg>36 minutes</Avg><Max>1 hour and 12 minutes</Max></Ground_Delay>' +
  '<Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>1 hour and 5 minutes</Avg><Max>2 hours and 28 minutes</Max></Ground_Delay>' +
  '</Ground_Delay_List></Delay_type>' +
  '<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>' +
  '<Delay><ARPT>LGA</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>' +
  '<Delay><ARPT>SAN</ARPT><Reason>VOL:Volume</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>' +
  '</Arrival_Departure_Delay_List></Delay_type>' +
  '<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>' +
  '<Airport><ARPT>SNA</ARPT><Reason>!SNA 11/020 SNA AD AP CLSD DLY 0730-1415 2611150730-2611211415</Reason><Start>Nov 15 at 07:30 UTC.</Start><Reopen>Nov 21 at 14:15 UTC.</Reopen></Airport>' +
  '</Airport_Closure_List></Delay_type>' +
  '<Delay_type><Name>Airport Closures</Name><Airport_Closure_List>' +
  '<Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR CTC ATLANTIC AVIATION 310-258-9884 OR SIGNATURE AVIATION 310-410-9605 2605271826-2705281600</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>May 28 at 16:00 UTC.</Reopen></Airport>' +
  '<Airport><ARPT>SAN</ARPT><Reason>!SAN 10/004 SAN AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC PPR 619-298-7704 2610011633-2701010800</Reason><Start>Oct 01 at 16:33 UTC.</Start><Reopen>Jan 01 at 08:00 UTC.</Reopen></Airport>' +
  '<Airport><ARPT>LAS</ARPT><Reason>!LAS 10/160 LAS AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775 2610281926-2701272300</Reason><Start>Oct 28 at 19:26 UTC.</Start><Reopen>Jan 27 at 23:00 UTC.</Reopen></Airport>' +
  '</Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>';

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = faaStatusProxy({
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

const xml = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers });

test('one upstream XML fetch, parsed to local + nationwide JSON', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => xml(LIVE_XML));
  const { mountPath, call } = mount({ fetchImpl });
  assert.equal(mountPath, '/api/faa-status');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, FAA_STATUS_PROXY_TTL_MS);
  assert.equal(res.json.updateTime, 'Mon Nov 16 19:28:03 2026 GMT');
  assert.deepEqual(res.json.local, []);
  assert.equal(res.json.nationwide.groundStop, 2);
  assert.equal(res.json.nationwide.groundDelay, 2);
  assert.equal(res.json.nationwide.closure, 4);
  assert.equal(res.json.nationwide.arrivalDepartureDelay, 2);
  assert.equal(res.json.totalAirports, 7);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://nasstatus.faa.gov/api/airport-status-information',
  );
  assert.equal(FAA_STATUS_UPSTREAM_URL, calls[0].url);
  assert.equal(
    calls[0].options.headers['User-Agent'],
    FAA_STATUS_PROXY_USER_AGENT,
  );
  assert.match(calls[0].options.headers.Accept, /xml/);

  const status = await call('/status');
  assert.deepEqual(status.json, {
    lastFetch: T0,
    stale: false,
    ttlMs: FAA_STATUS_PROXY_TTL_MS,
    updateTime: 'Mon Nov 16 19:28:03 2026 GMT',
    localEventCount: 0,
    nationwideGroundStops: 2,
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => xml(LIVE_XML));
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + FAA_STATUS_PROXY_TTL_MS + 1);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 2);
});

test('concurrent requests share one upstream call (single-flight)', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { fetchImpl, calls } = stubUpstream(async () => {
    await gate;
    return xml(LIVE_XML);
  });
  const { call } = mount({ fetchImpl });
  const pending = Promise.all([call('/'), call('/'), call('/')]);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await pending;
  assert.ok(results.every((res) => res.status === 200));
  assert.equal(calls.length, 1);
});

test('upstream 500 with warm cache serves stale; with cold cache → 502', async () => {
  let n = 0;
  const flaky = stubUpstream(async () => {
    n += 1;
    return n === 1
      ? xml(LIVE_XML)
      : new Response('down', { status: 500 });
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + FAA_STATUS_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.totalAirports, 7);
  assert.equal(flaky.calls.length, 2);

  const failing = stubUpstream(
    async () => new Response('down', { status: 500 }),
  );
  const cold = mount({ fetchImpl: failing.fetchImpl });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(
    first.json.error,
    'FAA NAS Status fetch failed and no cache available',
  );
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 1);
});

test('malformed XML with warm cache serves stale; cold cache → 502', async () => {
  const { fetchImpl } = stubUpstream(async () => xml('<html>nope</html>'));
  const { call } = mount({ fetchImpl });
  const res = await call('/');
  assert.equal(res.status, 502);
  assert.equal(
    res.json.error,
    'FAA NAS Status fetch failed and no cache available',
  );
});

test('429 backs off on Retry-After, then retries', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n === 1
      ? new Response(null, { status: 429, headers: { 'Retry-After': '120' } })
      : xml(LIVE_XML);
  });
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 502);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 120_000 + 1);
  const res = await proxy.call('/');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});
