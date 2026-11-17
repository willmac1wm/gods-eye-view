import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  marineWarningsProxy,
  extractRssItems,
  MARINE_WARNINGS_FEEDS,
  MARINE_WARNINGS_PROXY_TTL_MS,
  MARINE_WARNINGS_PROXY_USER_AGENT,
} from './marineWarnings.js';

const T0 = 1_793_123_456_789;

// Verbatim-shaped GovDelivery RSS (two items: one ATON, one cancellation).
const SDB_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>CG D05 Sector Delaware Bay - Maritime Safety Information - Recent Updates</title>
<item>
<title>SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26</title>
<link>https://content.govdelivery.com/accounts/USDHSCG/bulletins/432cd15</link>
<guid isPermaLink="false">70438165</guid>
<pubDate>Sat, 14 Nov 2026 04:24:32 -0600</pubDate>
<description><![CDATA[
        <p>1. LISTON RANGE FRONT LIGHT (LLNR 2445) REPORTED WITH A LOW INTENSITY LIGHT.<br />CANCEL AT//220000Z NOV 26//</p> <p>BT</p>
      ]]></description>
</item>
<item>
<title>CANCELLATION/SEC SDB BNM 0283-26</title>
<link>https://content.govdelivery.com/accounts/USDHSCG/bulletins/432e4d9</link>
<guid isPermaLink="false">70444249</guid>
<pubDate>Sun, 15 Nov 2026 20:43:18 -0600</pubDate>
<description><![CDATA[
        <p>1. CANCEL SEC SDB BNM 0283-26 DTG 052312Z NOV 26 A. AID NAME: BROWN SHOAL LIGHT B. LLNR: 1535</p> <p>BT</p>
      ]]></description>
</item>
</channel></rss>`;

const D5_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>District 5: USCG East District - Maritime Safety Information - Recent Updates</title>
<item>
<title>SAFETY/NJ-ABSECON INLET-CLAM CREEK/ATON/CGD-E BNM 0510-26</title>
<link>https://content.govdelivery.com/accounts/USDHSCG/bulletins/432e272</link>
<guid isPermaLink="false">70443634</guid>
<pubDate>Sun, 15 Nov 2026 15:27:03 -0600</pubDate>
<description><![CDATA[
        <p>1. CLAM CREEK BUOY 2 (LLNR 1245) TEMPORARILY DISESTABLISHED DUE TO DREDGING. CANCEL AT//161835Z NOV 26//</p> <p>BT</p>
      ]]></description>
</item>
</channel></rss>`;

function mount({ fetchImpl, cacheDir } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const dir = cacheDir ?? mkdtempSync(path.join(tmpdir(), 'gev-marine-proxy-'));
  const plugin = marineWarningsProxy({
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

const rss = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'application/rss+xml' },
  });

function bothFeeds() {
  return stubUpstream((url) => {
    if (url === MARINE_WARNINGS_FEEDS[0].url) return rss(SDB_RSS);
    if (url === MARINE_WARNINGS_FEEDS[1].url) return rss(D5_RSS);
    throw new Error(`unexpected upstream URL ${url}`);
  });
}

test('the two GovDelivery feeds are the documented USCG endpoints', () => {
  assert.deepEqual(
    MARINE_WARNINGS_FEEDS.map((feed) => feed.id),
    ['sector-delaware-bay', 'district-5'],
  );
  assert.equal(
    MARINE_WARNINGS_FEEDS[0].url,
    'https://public.govdelivery.com/topics/USDHSCG_248/feed.rss',
  );
  assert.equal(
    MARINE_WARNINGS_FEEDS[1].url,
    'https://public.govdelivery.com/topics/USDHSCG_250/feed.rss',
  );
  assert.equal(
    MARINE_WARNINGS_PROXY_USER_AGENT,
    'gods-eye-view/1.0 (+https://capemaydispatch.com)',
  );
});

test('extractRssItems reads CDATA descriptions and numeric guids', () => {
  const items = extractRssItems(SDB_RSS);
  assert.equal(items.length, 2);
  assert.equal(
    items[0].title,
    'SAFETY/DELAWARE RIVER/ATON/SEC SDB BNM 0288-26',
  );
  assert.equal(items[0].guid, '70438165');
  assert.equal(
    items[0].link,
    'https://content.govdelivery.com/accounts/USDHSCG/bulletins/432cd15',
  );
  assert.match(items[0].description, /LISTON RANGE FRONT LIGHT/);
  assert.match(items[0].description, /<p>/); // HTML stays verbatim here
  assert.equal(items[1].title, 'CANCELLATION/SEC SDB BNM 0283-26');
  assert.deepEqual(extractRssItems(''), []);
  assert.deepEqual(extractRssItems(null), []);
  assert.deepEqual(extractRssItems('<rss><channel></channel></rss>'), []);
  // An item without a title cannot be deduped downstream: skipped.
  assert.deepEqual(
    extractRssItems(
      '<rss><channel><item><guid>1</guid></item></channel></rss>',
    ),
    [],
  );
  // Plain (non-CDATA) descriptions work too.
  assert.equal(
    extractRssItems(
      '<rss><channel><item><title>T</title><description>plain</description></item></channel></rss>',
    )[0].description,
    'plain',
  );
});

test('both feeds merge into one payload with per-feed source rows', async () => {
  const upstream = bothFeeds();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  assert.equal(h.mountPath, '/api/marine-warnings');
  const res = await h.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, MARINE_WARNINGS_PROXY_TTL_MS);
  assert.equal(res.json.fetchedAt, T0);
  assert.equal(res.json.count, 3);
  assert.deepEqual(res.json.sources, [
    { feed: 'sector-delaware-bay', count: 2, ok: true },
    { feed: 'district-5', count: 1, ok: true },
  ]);
  assert.deepEqual(
    res.json.items.map((item) => item.feed),
    ['sector-delaware-bay', 'sector-delaware-bay', 'district-5'],
  );
  assert.equal(upstream.calls.length, 2);
  for (const call of upstream.calls) {
    assert.equal(
      call.options.headers['User-Agent'],
      MARINE_WARNINGS_PROXY_USER_AGENT,
    );
  }
  // The refresh is cached to disk (restart-proof).
  assert.ok(existsSync(path.join(h.cacheDir, 'marine-warnings.json')));
  const cached = JSON.parse(
    readFileSync(path.join(h.cacheDir, 'marine-warnings.json'), 'utf8'),
  );
  assert.equal(cached.items.length, 3);
});

test('fresh cache serves without an upstream call; stale cache refreshes', async () => {
  const upstream = bothFeeds();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  await h.call('/');
  assert.equal(upstream.calls.length, 2);
  await h.call('/');
  assert.equal(upstream.calls.length, 2); // served from memory
  h.setTime(T0 + MARINE_WARNINGS_PROXY_TTL_MS + 1);
  await h.call('/');
  assert.equal(upstream.calls.length, 4); // TTL passed: one refresh
});

test('concurrent requests share one upstream refresh (single-flight)', async () => {
  const resolvers = [];
  const upstream = stubUpstream(
    () =>
      new Promise((done) => {
        resolvers.push(done);
      }),
  );
  // Both feeds hang until released; resolve both with empty feeds.
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const first = h.call('/');
  const second = h.call('/');
  // Let both handlers reach the shared inflight promise.
  await new Promise((done) => setImmediate(done));
  for (const resolveFetch of resolvers)
    resolveFetch(rss('<rss><channel></channel></rss>'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  // Two feeds, one refresh pass: exactly two upstream calls total.
  assert.equal(upstream.calls.length, 2);
});

test('one feed down still serves the other, marked ok:false', async () => {
  const upstream = stubUpstream((url) => {
    if (url === MARINE_WARNINGS_FEEDS[0].url) return rss(SDB_RSS);
    return new Response('Bad Gateway', { status: 502 });
  });
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const res = await h.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.count, 2);
  assert.deepEqual(res.json.sources, [
    { feed: 'sector-delaware-bay', count: 2, ok: true },
    { feed: 'district-5', count: 0, ok: false },
  ]);
  assert.match(h.warnings.join(' '), /district-5 fetch failed/);
});

test('both feeds down serves stale cache, else 502', async () => {
  const failing = stubUpstream(
    () => new Response('Bad Gateway', { status: 502 }),
  );
  const h = mount({ fetchImpl: failing.fetchImpl });
  const cold = await h.call('/');
  assert.equal(cold.status, 502);
  assert.equal(
    cold.json.error,
    'marine warnings fetch failed and no cache available',
  );

  // Warm the cache, then take both feeds down.
  const upstream = bothFeeds();
  const warm = mount({ fetchImpl: upstream.fetchImpl, cacheDir: h.cacheDir });
  await warm.call('/');
  const stale = mount({ fetchImpl: failing.fetchImpl, cacheDir: h.cacheDir });
  stale.setTime(T0 + MARINE_WARNINGS_PROXY_TTL_MS + 1);
  const res = await stale.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, true);
  assert.equal(res.json.count, 3);
});

test('status reports last fetch, count, staleness, and sources', async () => {
  const upstream = bothFeeds();
  const h = mount({ fetchImpl: upstream.fetchImpl });
  const before = await h.call('/status');
  assert.deepEqual(before.json, {
    lastFetch: null,
    count: null,
    stale: false,
    ttlMs: MARINE_WARNINGS_PROXY_TTL_MS,
    sources: null,
  });
  await h.call('/');
  const after = await h.call('/status');
  assert.equal(after.json.lastFetch, T0);
  assert.equal(after.json.count, 3);
  assert.equal(after.json.stale, false);
  assert.equal(after.json.sources.length, 2);
  h.setTime(T0 + MARINE_WARNINGS_PROXY_TTL_MS + 1);
  const stale = await h.call('/status');
  assert.equal(stale.json.stale, true);
});

test('oversized and non-RSS upstream bodies fail the feed, not the server', async () => {
  const huge = stubUpstream(
    () => new Response('x'.repeat(3 * 1024 * 1024), { status: 200 }),
  );
  const h = mount({ fetchImpl: huge.fetchImpl });
  const res = await h.call('/');
  assert.equal(res.status, 502);
  const html = stubUpstream(
    () =>
      new Response('<html><body>not rss</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  const h2 = mount({ fetchImpl: html.fetchImpl });
  const res2 = await h2.call('/');
  assert.equal(res2.status, 502);
});

test('a disk cache from a previous process serves without upstream', async () => {
  const upstream = bothFeeds();
  const first = mount({ fetchImpl: upstream.fetchImpl });
  await first.call('/');
  assert.equal(upstream.calls.length, 2);
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
