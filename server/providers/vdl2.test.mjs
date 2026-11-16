import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  vdl2DailyProxy,
  vdl2UpstreamUrls,
  VDL2_PROXY_TTL_MS,
  VDL2_PROXY_USER_AGENT,
} from './vdl2.js';

const T0 = Date.parse('2026-11-16T07:39:25Z');

// Real airframes.io record shapes (verified live 2026-11-16), trimmed
// to the fields the proxy reads. The mayday is heard by PhillyRox; the
// diversion is a California message that must not survive selection;
// the undecoded frame has no label, text, or data.
const MAYDAY = {
  id: 8135359152,
  sourceType: 'vdl',
  source: 'dumpvdl2',
  mode: '2',
  label: 'H1',
  text: 'MAYDAY MAYDAY',
  tail: 'N219BZ',
  fromHex: 'A12345',
  frequency: 136.65,
  latitude: null,
  longitude: null,
  createdAt: '2026-11-16T07:39:25.625Z',
  data: null,
  station: {
    id: 237335008,
    ident: 'PhillyRox-VDLM',
    nearestAirportIcao: 'KPHL',
    flagged: true,
    flaggedReason: 'Rate anomaly detected',
  },
  flight: {
    flight: 'MX501',
    departingAirport: 'MMMX',
    destinationAirport: 'KPHL',
    latitude: 39.5,
    longitude: -74.9,
  },
  airframe: { tail: 'N219BZ' },
};

const ROUTINE = {
  ...MAYDAY,
  id: 8135359153,
  text: '0,00000,00000,00000,-7.75,-5.69,0.117,0.152,',
};

const UNDECODED = {
  ...MAYDAY,
  id: 8135359154,
  label: null,
  text: null,
  data: null,
  mode: null,
  createdAt: '2026-11-16T07:39:20.000Z',
};

const FAR_DIVERSION = {
  id: 8135359155,
  sourceType: 'vdl',
  source: 'dumpvdl2',
  mode: '2',
  label: 'H1',
  text: 'DIVERTING TO KLAX',
  tail: 'N456CD',
  fromHex: 'A67890',
  frequency: 136.65,
  latitude: null,
  longitude: null,
  createdAt: '2026-11-16T07:38:00.000Z',
  data: null,
  station: { id: 1, ident: 'FAR', nearestAirportIcao: 'KLAX' },
  flight: {
    flight: 'AA1',
    departingAirport: 'KJFK',
    destinationAirport: 'KLAX',
    latitude: 34.0,
    longitude: -118.0,
  },
  airframe: { tail: 'N456CD' },
};

const ACARS_MAYDAY = {
  ...MAYDAY,
  id: 8135359156,
  sourceType: 'acars',
  source: 'acarsdec',
};

test('vdl2UpstreamUrls queries the PhillyRox station, then the 11 keywords', () => {
  const urls = vdl2UpstreamUrls();
  assert.equal(urls.length, 12);
  assert.match(urls[0], /station_ids=237335008/);
  assert.match(urls[0], /timeframe=last-hour&limit=100/);
  assert.match(urls[1], /text=DIVERT/);
  assert.match(urls[2], /text=EMERGENCY/);
  assert.match(urls[3], /text=MAYDAY/);
  assert.match(urls[4], /text=PAN%20PAN/);
  assert.match(urls[11], /text=BIRD%20STRIKE/);
  assert.ok(urls.every((url) => url.startsWith('https://api.airframes.io/v1/messages?')));
});

function mount({ fetchImpl, cacheDir } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const dir = cacheDir ?? mkdtempSync(path.join(tmpdir(), 'gev-vdl2-proxy-'));
  const plugin = vdl2DailyProxy({
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
      status: null,
      headers: null,
      body: null,
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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function liveUpstream() {
  return stubUpstream((url) => {
    if (String(url).includes('station_ids=237335008'))
      return json([MAYDAY, ROUTINE, UNDECODED]);
    if (String(url).includes('text=MAYDAY')) return json([MAYDAY]);
    if (String(url).includes('text=DIVERT')) return json([FAR_DIVERSION]);
    if (String(url).includes('text=EMERGENCY')) return json([ACARS_MAYDAY]);
    return json([]);
  });
}

test('proxy mounts at /api/vdl2 and serves the selected rows, never the text', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const h = mount({ fetchImpl });
  assert.equal(h.mountPath, '/api/vdl2');
  const res = await h.call('/api/vdl2');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, VDL2_PROXY_TTL_MS);
  assert.equal(res.json.heardLocal, 3);
  assert.equal(res.json.heardTruncated, false);
  assert.equal(res.json.stationFlagged, true);
  assert.equal(res.json.stationFlagReason, 'Rate anomaly detected');
  assert.equal(res.json.count, 2);
  assert.deepEqual(
    res.json.rows.map((row) => row.category),
    ['mayday', 'undecoded'],
  );
  // The guardrail, end to end: no row carries raw message text.
  assert.equal(JSON.stringify(res.json).includes('MAYDAY MAYDAY'), false);
  assert.equal(res.json.rows[0].flight, 'MX501');
  assert.equal(res.json.rows[0].url, 'https://api.airframes.io/v1/messages/8135359152');
  assert.equal(calls.length, 12);
  assert.equal(calls[0].options.headers['User-Agent'], VDL2_PROXY_USER_AGENT);
  assert.ok(calls.every(({ url }) => String(url).includes('timeframe=last-hour')));
  // Second call inside the TTL is served from memory without upstream traffic.
  const again = await h.call('/api/vdl2');
  assert.equal(again.status, 200);
  assert.equal(calls.length, 12);
  // The disk cache survives a restart: a fresh mount reads it, no fetch.
  const h2 = mount({ fetchImpl, cacheDir: h.cacheDir });
  const cached = await h2.call('/api/vdl2');
  assert.equal(cached.status, 200);
  assert.equal(cached.json.count, 2);
  assert.equal(calls.length, 12);
  assert.equal(existsSync(path.join(h.cacheDir, 'vdl2.json')), true);
  assert.equal(
    JSON.parse(readFileSync(path.join(h.cacheDir, 'vdl2.json'), 'utf8')).rows.length,
    2,
  );
});

test('proxy serves stale cache when the upstream fails, and 502 with none', async () => {
  const good = liveUpstream();
  const h = mount({ fetchImpl: good.fetchImpl });
  const first = await h.call('/api/vdl2');
  assert.equal(first.status, 200);
  assert.equal(good.calls.length, 12);

  // Upstream now fails outright; the TTL has expired.
  const failing = stubUpstream(() => json({ error: 'boom' }, 500));
  const h2 = mount({ fetchImpl: failing.fetchImpl, cacheDir: h.cacheDir });
  h2.setTime(T0 + VDL2_PROXY_TTL_MS + 1000);
  const stale = await h2.call('/api/vdl2');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.count, 2);

  // No cache at all → 502.
  const h3 = mount({ fetchImpl: failing.fetchImpl });
  const empty = await h3.call('/api/vdl2');
  assert.equal(empty.status, 502);
  assert.match(empty.json.error, /vdl2 fetch failed/);
});

test('proxy status endpoint reports the cached rows without fetching', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const h = mount({ fetchImpl });
  // Vite strips the /api/vdl2 mount prefix before the handler sees
  // the request, so the handler receives '/status' here.
  const before = await h.call('/status');
  assert.equal(before.status, 200);
  assert.equal(before.json.lastFetch, null);
  assert.equal(before.json.heardLocal, null);
  assert.equal(before.json.count, null);
  assert.equal(calls.length, 0);
  await h.call('/api/vdl2');
  const after = await h.call('/status');
  assert.equal(after.json.lastFetch, T0);
  assert.equal(after.json.heardLocal, 3);
  assert.equal(after.json.count, 2);
  assert.equal(after.json.stale, false);
  h.setTime(T0 + VDL2_PROXY_TTL_MS + 1000);
  const expired = await h.call('/status');
  assert.equal(expired.json.stale, true);
});
