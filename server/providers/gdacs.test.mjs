// server/providers/gdacs.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGdacsRssItems,
  gdacsProxy,
  gdacsUpstreamUrl,
  GDACS_PROXY_TTL_MS,
  GDACS_PROXY_USER_AGENT,
} from './gdacs.js';

const T0 = 1_793_123_456_789;

// Trimmed verbatim GDACS items from the live feed, 2026-11-17.
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#" xmlns:georss="http://www.georss.org/georss">
<channel><title>GDACS Alerts</title>
<item>
<title>Green earthquake (Magnitude 6.6M, Depth:68km) in Indonesia 16/11/2026 21:11 UTC, 6 thousand in MMI V.</title>
<description>On 11/16/2026 9:11:17 PM, an earthquake occurred in Indonesia potentially affecting 6 thousand in MMI V. The earthquake had Magnitude 6.6M, Depth:68km.</description>
<link>http://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1577696</link>
<pubDate>Mon, 16 Nov 2026 21:26:52 GMT</pubDate>
<gdacs:fromdate>Mon, 16 Nov 2026 21:11:17 GMT</gdacs:fromdate>
<gdacs:todate>Mon, 16 Nov 2026 21:11:17 GMT</gdacs:todate>
<gdacs:iscurrent>true</gdacs:iscurrent>
<geo:Point><geo:lat>-6.0804</geo:lat><geo:long>131.4868</geo:long></geo:Point>
<georss:point>-6.0804 131.4868</georss:point>
<gdacs:eventtype>EQ</gdacs:eventtype>
<gdacs:alertlevel>Green</gdacs:alertlevel>
<gdacs:alertscore>0</gdacs:alertscore>
<gdacs:eventid>1577696</gdacs:eventid>
<gdacs:severity unit="M" value="6.6">Magnitude 6.6M, Depth:68km</gdacs:severity>
<gdacs:population unit="in MMI V" value="6100">6 thousand in MMI V</gdacs:population>
<gdacs:iso3>IDN</gdacs:iso3>
<gdacs:country>Indonesia</gdacs:country>
<gdacs:glide />
</item>
<item>
<title>Orange notification for tropical cyclone AKVAN-26. Population affected by Category 1 (120 km/h) wind speeds or higher is 0  (11.162 million in Tropical Storm).</title>
<description>From 16/11/2026 to 17/11/2026, a Tropical Storm (maximum wind speed of 93 km/h) AKVAN-26 was active in NorthIndian.</description>
<link>http://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1001351</link>
<pubDate>Mon, 16 Nov 2026 20:06:39 GMT</pubDate>
<gdacs:fromdate>Mon, 16 Nov 2026 18:00:00 GMT</gdacs:fromdate>
<gdacs:todate>Tue, 17 Nov 2026 06:00:00 GMT</gdacs:todate>
<gdacs:iscurrent>true</gdacs:iscurrent>
<geo:Point><geo:lat>12</geo:lat><geo:long>87.3</geo:long></geo:Point>
<georss:point>12 87.3</georss:point>
<gdacs:eventtype>TC</gdacs:eventtype>
<gdacs:alertlevel>Orange</gdacs:alertlevel>
<gdacs:alertscore>2</gdacs:alertscore>
<gdacs:eventid>1001351</gdacs:eventid>
<gdacs:severity unit="km/h" value="92.592">Tropical Storm (maximum wind speed of 93 km/h)</gdacs:severity>
<gdacs:country>India</gdacs:country>
<gdacs:iso3>IND</gdacs:iso3>
</item>
</channel></rss>`;

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = gdacsProxy({
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

const rss = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers });

test('the upstream URL is the GDACS RSS feed, no key of any kind', () => {
  assert.equal(gdacsUpstreamUrl(), 'https://www.gdacs.org/xml/rss.xml');
  assert.equal(
    GDACS_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('extractGdacsRssItems parses the live quake and cyclone items', () => {
  const items = extractGdacsRssItems(RSS);
  assert.equal(items.length, 2);
  const [quake, cyclone] = items;
  assert.equal(quake.eventType, 'EQ');
  assert.equal(quake.alertLevel, 'Green');
  assert.equal(quake.eventId, '1577696');
  assert.equal(quake.country, 'Indonesia');
  assert.equal(quake.iso3, 'IDN');
  assert.equal(quake.lat, '-6.0804');
  assert.equal(quake.lon, '131.4868');
  assert.equal(
    quake.link,
    'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
  );
  assert.deepEqual(quake.severity, {
    text: 'Magnitude 6.6M, Depth:68km',
    unit: 'M',
    value: '6.6',
  });
  assert.deepEqual(quake.population, {
    text: '6 thousand in MMI V',
    unit: 'in MMI V',
    value: '6100',
  });
  assert.equal(cyclone.eventType, 'TC');
  assert.equal(cyclone.alertLevel, 'Orange');
  assert.equal(cyclone.eventId, '1001351');
  assert.equal(cyclone.severity.value, '92.592');
  assert.deepEqual(extractGdacsRssItems(''), []);
  assert.equal(extractGdacsRssItems('<rss></rss>').length, 0);
  assert.deepEqual(extractGdacsRssItems(null), []);
});

test('one upstream call per refresh, no key of any kind', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => rss(RSS));
  const { mountPath, call } = mount({ fetchImpl });
  assert.equal(mountPath, '/api/gdacs');

  const res = await call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, GDACS_PROXY_TTL_MS);
  assert.equal(res.json.count, 2);
  assert.equal(res.json.events[0].eventType, 'EQ');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.gdacs.org/xml/rss.xml');
  assert.equal(
    calls[0].options.headers['User-Agent'],
    GDACS_PROXY_USER_AGENT,
  );
  assert.equal(calls[0].options.headers.Authorization, undefined);

  const status = await call('/status');
  assert.deepEqual(status.json, {
    lastFetch: T0,
    count: 2,
    stale: false,
    ttlMs: GDACS_PROXY_TTL_MS,
  });
});

test('second request inside TTL is a cache hit; after TTL it refreshes', async () => {
  const { fetchImpl, calls } = stubUpstream(async () => rss(RSS));
  const proxy = mount({ fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + 60_000);
  assert.equal((await proxy.call('/')).status, 200);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + GDACS_PROXY_TTL_MS + 1);
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
    return rss(RSS);
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
    return n === 1 ? rss(RSS) : rss('down', 500);
  });
  const proxy = mount({ fetchImpl: flaky.fetchImpl });
  assert.equal((await proxy.call('/')).status, 200);
  proxy.setTime(T0 + GDACS_PROXY_TTL_MS + 1);
  const stale = await proxy.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.count, 2);
  assert.equal(flaky.calls.length, 2);

  const failing = stubUpstream(async () => rss('down', 500));
  const cold = mount({ fetchImpl: failing.fetchImpl });
  const first = await cold.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'GDACS fetch failed and no cache available');
  const second = await cold.call('/');
  assert.equal(second.status, 502);
  assert.equal(failing.calls.length, 1);
});

test('429 backs off on Retry-After, then retries', async () => {
  let n = 0;
  const { fetchImpl, calls } = stubUpstream(async () => {
    n += 1;
    return n === 1
      ? rss('slow down', 429, { 'Retry-After': '2' })
      : rss(RSS);
  });
  const proxy = mount({ fetchImpl });
  const first = await proxy.call('/');
  assert.equal(first.status, 502);
  assert.equal(first.json.error, 'GDACS rate limited (HTTP 429)');
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 1_000);
  const backedOff = await proxy.call('/');
  assert.equal(backedOff.status, 502);
  assert.equal(calls.length, 1);
  proxy.setTime(T0 + 2_001);
  const retried = await proxy.call('/');
  assert.equal(retried.status, 200);
  assert.equal(retried.json.count, 2);
  assert.equal(calls.length, 2);
});

test('a non-RSS upstream response is a 502, not a silent empty feed', async () => {
  const { fetchImpl } = stubUpstream(async () =>
    rss('<html>not a feed</html>'),
  );
  const proxy = mount({ fetchImpl });
  const res = await proxy.call('/');
  assert.equal(res.status, 502);
  assert.equal(res.json.error, 'GDACS fetch failed and no cache available');
});
