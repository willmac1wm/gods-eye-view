import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disasterHistoryProxy,
  DISASTER_HISTORY_PROXY_TTL_MS,
  DISASTER_HISTORY_PROXY_USER_AGENT,
} from './disasterHistory.js';

const T0 = 1_793_123_456_789;

// Live OpenFEMA rows: the newest (Ida) and the oldest Sandy declaration.
const FEMA_PAYLOAD = {
  metadata: { url: 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries' },
  DisasterDeclarationsSummaries: [
    {
      disasterNumber: 4614,
      declarationDate: '2021-09-05T00:00:00.000Z',
      disasterName: 'HURRICANE IDA',
      incidentType: 'Hurricane',
      declarationType: 'DR',
      state: 'NJ',
      designatedArea: 'Cape May (County)',
      incidentBeginDate: '2021-09-01T00:00:00.000Z',
      incidentEndDate: '2021-09-03T00:00:00.000Z',
    },
    {
      disasterNumber: 4086,
      declarationDate: '2012-10-30T00:00:00.000Z',
      disasterName: 'HURRICANE SANDY',
      incidentType: 'Hurricane',
      declarationType: 'DR',
      state: 'NJ',
      designatedArea: 'Cape May (County)',
      incidentBeginDate: '2012-10-26T00:00:00.000Z',
      incidentEndDate: '2012-11-08T00:00:00.000Z',
    },
  ],
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const plugin = disasterHistoryProxy({
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

test('first call fetches OpenFEMA and serves declarations + the Storm Events snapshot', async () => {
  const calls = [];
  const m = mount({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json(FEMA_PAYLOAD);
    },
  });
  assert.equal(m.mountPath, '/api/disaster-history');
  const res = await m.call('/');
  assert.equal(res.status, 200);
  assert.equal(res.json.stale, false);
  assert.equal(res.json.ttlMs, DISASTER_HISTORY_PROXY_TTL_MS);
  assert.equal(res.json.fema.DisasterDeclarationsSummaries.length, 2);
  assert.equal(
    res.json.fema.DisasterDeclarationsSummaries[0].disasterName,
    'HURRICANE IDA',
  );
  assert.equal(res.json.stormEvents.years['2021'].length, 16);
  assert.equal(res.json.stormEvents.years['2012'].length, 78);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /fema\.gov\/api\/open\/v2\/DisasterDeclarationsSummaries/);
  assert.equal(
    calls[0].options.headers['User-Agent'],
    DISASTER_HISTORY_PROXY_USER_AGENT,
  );

  const status = await m.call('/status');
  assert.equal(status.json.declarationCount, 2);
  assert.deepEqual(status.json.stormEventYears, ['2012', '2021', '2024', '2025']);
});

test('a second call inside the TTL is a cache hit (no second fetch)', async () => {
  let calls = 0;
  const m = mount({
    fetchImpl: async () => {
      calls += 1;
      return json(FEMA_PAYLOAD);
    },
  });
  await m.call('/');
  await m.call('/');
  assert.equal(calls, 1);
});

test('after the TTL, an upstream 500 serves the stale cache', async () => {
  let fail = false;
  const m = mount({
    fetchImpl: async () =>
      fail ? json({ error: 'boom' }, 500) : json(FEMA_PAYLOAD),
  });
  const fresh = await m.call('/');
  assert.equal(fresh.json.stale, false);
  fail = true;
  m.setTime(T0 + DISASTER_HISTORY_PROXY_TTL_MS + 1);
  const stale = await m.call('/');
  assert.equal(stale.status, 200);
  assert.equal(stale.json.stale, true);
  assert.equal(stale.json.fema.DisasterDeclarationsSummaries.length, 2);
  assert.match(m.warnings.join(' '), /refresh failed/);
});

test('a cold cache with a failing upstream answers 502', async () => {
  const m = mount({
    fetchImpl: async () => json({ error: 'boom' }, 500),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
  assert.match(res.json.error, /no cache available/);
});

test('a malformed upstream payload (no declarations array) answers 502 cold', async () => {
  const m = mount({
    fetchImpl: async () => json({ metadata: {} }),
  });
  const res = await m.call('/');
  assert.equal(res.status, 502);
});
