import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  gpsjamDailyProxy,
  parseGpsjamCsv,
  parseGpsjamManifest,
  gpsjamCandidateDates,
  gpsjamLevel,
  GPSJAM_PROXY_TTL_MS,
  GPSJAM_PROXY_USER_AGENT,
} from './gpsjam.js';

const T0 = Date.parse('2026-11-16T07:08:00Z');

// Real gpsjam.org rows (2026-11-15 file): the CMCH hex, a medium and a
// high cell elsewhere, a sparse cell that must be dropped, and a bad row.
const CSV = `hex,count_good_aircraft,count_bad_aircraft
842aad9ffffffff,726,0
84088a3ffffffff,19,2
84088a1ffffffff,6,3
8400051ffffffff,0,1
842aad7ffffffff,514,1
not-a-hex,5,0
842aaddffffffff,736,0
842aad9ffffffff,726,0
`;

const MANIFEST = `date,suspect,num_bad_aircraft_hexes,source
2026-08-26,false,519,adsbexchange
2026-08-27,false,614,merged
2026-11-14,false,522,merged
2026-11-15,false,497,merged
`;

test('gpsjamCandidateDates tries yesterday UTC, then the day before', () => {
  assert.deepEqual(gpsjamCandidateDates(T0), ['2026-11-15', '2026-11-14']);
  assert.deepEqual(gpsjamCandidateDates(Date.parse('2026-11-16T00:30:00Z')), [
    '2026-11-15',
    '2026-11-14',
  ]);
  assert.deepEqual(gpsjamCandidateDates(Date.parse('2026-11-16T23:59:00Z')), [
    '2026-11-15',
    '2026-11-14',
  ]);
});

test('parseGpsjamManifest reads the suspect flag and the source switch', () => {
  const manifest = parseGpsjamManifest(MANIFEST);
  assert.equal(manifest.get('2026-08-26').source, 'adsbexchange');
  assert.equal(manifest.get('2026-08-27').source, 'merged');
  assert.equal(manifest.get('2026-11-15').suspect, false);
  assert.equal(manifest.get('2026-11-15').source, 'merged');
  assert.equal(parseGpsjamManifest('').size, 0);
  assert.equal(parseGpsjamManifest(null).size, 0);
  const suspect = parseGpsjamManifest(
    'date,suspect,num_bad_aircraft_hexes,source\n2022-02-14,true,89,adsbexchange\n',
  );
  assert.equal(suspect.get('2022-02-14').suspect, true);
});

test('gpsjamLevel discounts the first bad aircraft, then applies the 2/10 bands', () => {
  assert.deepEqual(gpsjamLevel(726, 0), { percent: 0, level: 'low' });
  assert.deepEqual(gpsjamLevel(21, 2), { percent: 4.8, level: 'medium' });
  assert.deepEqual(gpsjamLevel(9, 3), { percent: 22.2, level: 'high' });
  assert.deepEqual(gpsjamLevel(50, 2), { percent: 2, level: 'medium' });
  // The band reads the raw percent: 1.96% displays as 2.0 but stays low.
  assert.deepEqual(gpsjamLevel(51, 2), { percent: 2, level: 'low' });
  assert.deepEqual(gpsjamLevel(101, 2), { percent: 1, level: 'low' });
  assert.deepEqual(gpsjamLevel(2, 2), { percent: 50, level: 'high' });
  assert.deepEqual(gpsjamLevel(0, 0), { percent: 0, level: 'low' });
});

test('parseGpsjamCsv keeps county cells with geometry and drops the rest', () => {
  const { worldRows, droppedRows, cells } = parseGpsjamCsv(CSV);
  assert.equal(worldRows, 8);
  assert.equal(droppedRows, 1);
  // Only the CMCH hexes survive the county box + 0.5° margin; the
  // medium/high rows are far away, the 0/1 row is too sparse, and the
  // duplicated CMCH row is kept twice (dedup lives in the client).
  const hexes = cells.map((cell) => cell.hex);
  assert.deepEqual(hexes, [
    '842aad7ffffffff',
    '842aad9ffffffff',
    '842aad9ffffffff',
    '842aaddffffffff',
  ]);
  const cmch = cells.find((cell) => cell.hex === '842aad9ffffffff');
  assert.equal(cmch.good, 726);
  assert.equal(cmch.bad, 0);
  assert.equal(cmch.total, 726);
  assert.equal(cmch.percent, 0);
  assert.equal(cmch.level, 'low');
  assert.ok(Math.abs(cmch.lat - 39.288) < 0.01);
  assert.ok(Math.abs(cmch.lon + 74.745) < 0.01);
  // Six boundary vertices, GeoJSON [lon, lat], closing duplicate stripped.
  assert.equal(cmch.boundary.length, 6);
  for (const [lon, lat] of cmch.boundary) {
    assert.ok(lon > -75.1 && lon < -74.4);
    assert.ok(lat > 39.0 && lat < 39.6);
  }
  assert.equal(parseGpsjamCsv('').cells.length, 0);
  assert.equal(parseGpsjamCsv(null).cells.length, 0);
});

function mount({ fetchImpl, cacheDir } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const dir = cacheDir ?? mkdtempSync(path.join(tmpdir(), 'gev-gpsjam-proxy-'));
  const plugin = gpsjamDailyProxy({
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

const csv = (body, status = 200) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/csv' },
  });

function liveUpstream() {
  return stubUpstream((url) => {
    if (String(url).endsWith('/manifest.csv')) return csv(MANIFEST);
    if (String(url).endsWith('/2026-11-15-h3_4.csv')) return csv(CSV);
    if (String(url).endsWith('/2026-11-14-h3_4.csv')) return csv(CSV);
    return csv('', 404);
  });
}

test('proxy mounts at /api/gpsjam and serves the filtered county cells', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const h = mount({ fetchImpl });
  assert.equal(h.mountPath, '/api/gpsjam');
  const res = await h.call('/api/gpsjam');
  assert.equal(res.status, 200);
  assert.equal(res.json.date, '2026-11-15');
  assert.equal(res.json.source, 'merged');
  assert.equal(res.json.suspect, false);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, GPSJAM_PROXY_TTL_MS);
  assert.equal(res.json.worldRows, 8);
  assert.equal(res.json.count, 4);
  assert.equal(res.json.cells[0].hex, '842aad7ffffffff');
  assert.equal(res.json.cells[0].boundary.length, 6);
  assert.equal(calls[0].url, 'https://gpsjam.org/data/manifest.csv');
  assert.equal(calls[1].url, 'https://gpsjam.org/data/2026-11-15-h3_4.csv');
  assert.equal(calls[1].options.headers['User-Agent'], GPSJAM_PROXY_USER_AGENT);
  // Second call inside the TTL is served from memory without upstream traffic.
  const again = await h.call('/api/gpsjam');
  assert.equal(again.status, 200);
  assert.equal(again.json.date, '2026-11-15');
  assert.equal(calls.length, 2);
  // The disk cache survives a restart: a fresh mount reads it, no fetch.
  const h2 = mount({ fetchImpl, cacheDir: h.cacheDir });
  const cached = await h2.call('/api/gpsjam');
  assert.equal(cached.status, 200);
  assert.equal(cached.json.date, '2026-11-15');
  assert.equal(calls.length, 2);
  assert.equal(existsSync(path.join(h.cacheDir, 'gpsjam.json')), true);
  assert.equal(
    JSON.parse(readFileSync(path.join(h.cacheDir, 'gpsjam.json'), 'utf8')).date,
    '2026-11-15',
  );
});

test('proxy falls back to the prior day when yesterday is not published yet', async () => {
  const { fetchImpl, calls } = stubUpstream((url) => {
    if (String(url).endsWith('/manifest.csv')) return csv(MANIFEST);
    if (String(url).endsWith('/2026-11-15-h3_4.csv')) return csv('', 404);
    if (String(url).endsWith('/2026-11-14-h3_4.csv')) return csv(CSV);
    return csv('', 404);
  });
  const h = mount({ fetchImpl });
  const res = await h.call('/api/gpsjam');
  assert.equal(res.status, 200);
  assert.equal(res.json.date, '2026-11-14');
  assert.equal(res.json.source, 'merged');
  assert.ok(
    calls.some(({ url }) => String(url).endsWith('/2026-11-15-h3_4.csv')),
  );
  assert.ok(
    calls.some(({ url }) => String(url).endsWith('/2026-11-14-h3_4.csv')),
  );
});

test('proxy serves stale cache when the upstream fails, and 502 with none', async () => {
  const good = liveUpstream();
  const h = mount({ fetchImpl: good.fetchImpl });
  const first = await h.call('/api/gpsjam');
  assert.equal(first.status, 200);
  assert.equal(good.calls.length, 2);

  // Upstream now fails outright; the TTL has expired.
  const failing = stubUpstream(() => csv('boom', 500));
  const h2 = mount({ fetchImpl: failing.fetchImpl, cacheDir: h.cacheDir });
  h2.setTime(T0 + GPSJAM_PROXY_TTL_MS + 1000);
  const stale = await h2.call('/api/gpsjam');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.date, '2026-11-15');

  // No cache at all → 502.
  const h3 = mount({ fetchImpl: failing.fetchImpl });
  const empty = await h3.call('/api/gpsjam');
  assert.equal(empty.status, 502);
  assert.match(empty.json.error, /gpsjam fetch failed/);
});

test('proxy works without the manifest and reports a suspect day', async () => {
  const { fetchImpl } = stubUpstream((url) => {
    if (String(url).endsWith('/manifest.csv')) return csv('boom', 500);
    if (String(url).endsWith('/2026-11-15-h3_4.csv')) return csv(CSV);
    return csv('', 404);
  });
  const h = mount({ fetchImpl });
  const res = await h.call('/api/gpsjam');
  assert.equal(res.status, 200);
  assert.equal(res.json.date, '2026-11-15');
  assert.equal(res.json.source, null);
  assert.equal(res.json.suspect, null);

  const suspectManifest = MANIFEST.replace(
    '2026-11-15,false,497,merged',
    '2026-11-15,true,497,merged',
  );
  const { fetchImpl: fetchImpl2 } = stubUpstream((url) => {
    if (String(url).endsWith('/manifest.csv')) return csv(suspectManifest);
    if (String(url).endsWith('/2026-11-15-h3_4.csv')) return csv(CSV);
    return csv('', 404);
  });
  const h2 = mount({ fetchImpl: fetchImpl2 });
  const res2 = await h2.call('/api/gpsjam');
  assert.equal(res2.status, 200);
  assert.equal(res2.json.suspect, true);
});

test('proxy status endpoint reports the cached day without fetching', async () => {
  const { fetchImpl, calls } = liveUpstream();
  const h = mount({ fetchImpl });
  // Vite strips the /api/gpsjam mount prefix before the handler sees
  // the request, so the handler receives '/status' here.
  const before = await h.call('/status');
  assert.equal(before.status, 200);
  assert.equal(before.json.lastFetch, null);
  assert.equal(before.json.date, null);
  assert.equal(before.json.count, null);
  assert.equal(calls.length, 0);
  await h.call('/api/gpsjam');
  const after = await h.call('/status');
  assert.equal(after.json.lastFetch, T0);
  assert.equal(after.json.date, '2026-11-15');
  assert.equal(after.json.count, 4);
  assert.equal(after.json.stale, false);
  h.setTime(T0 + GPSJAM_PROXY_TTL_MS + 1000);
  const expired = await h.call('/status');
  assert.equal(expired.json.stale, true);
});
