// server/providers/navarea.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { navareaProxy } from './navarea.js';

const T0 = 1_793_123_456_789;

// Real NAVAREA IV bulletin excerpts, indexed live text 131651Z NOV 26.
const BULLETIN = `131651Z NOV 26

NAVAREA IV 1098/26.

1. NAVAREA IV WARNINGS IN FORCE AS OF 131651Z NOV.

 ALL THE INFORCE WARNINGS ARE LISTED HERE.

 1097/2026, 1096/2026.

3. CANCEL NAVAREA IV 1072/26.

131431Z NOV 26

NAVAREA IV 1097/26

CARIBBEAN SEA.

ANTIGUA AND BARBUDA.

1. DERELICT VESSEL CAPSIZED AND ADRIFT
 IN 17-02.98N 061-57.65W AT 122007Z NOV.

2. CANCEL THIS MSG 161431Z NOV 26.

131421Z NOV 26

NAVAREA IV 1096/26

CARIBBEAN SEA.

SAINT LUCIA.

1. GUNNERY EXERCISES 171800Z TO 172200Z,
 181200Z TO 181600Z, 181800Z TO 182200Z NOV
 IN AREA WITHIN 12 MILES OF 14-35.00N 061-47.30W.

2. CANCEL THIS MSG 182300Z NOV 26.
`;

function mount({ fetchImpl } = {}) {
  let currentTime = T0;
  const clock = () => currentTime;
  const warnings = [];
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'gev-navarea-'));
  const plugin = navareaProxy({
    fetchImpl,
    now: clock,
    warn: (...args) => warnings.push(args.join(' ')),
    cacheDir,
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
      body: res.body ? JSON.parse(res.body) : null,
    };
  };
  return {
    mountPath,
    warnings,
    cacheDir,
    call,
    advance(ms) {
      currentTime += ms;
    },
  };
}

test('navarea proxy mounts on /api/navarea', () => {
  const { mountPath } = mount();
  assert.equal(mountPath, '/api/navarea');
});

test('navarea proxy fetches the daily bulletin once and caches it 24 h', async () => {
  let calls = 0;
  const h = mount({
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(
        url,
        /msi\.nga\.mil\/api\/publications\/download\?key=.*DailyMemIV\.txt&type=view/,
      );
      return new Response(BULLETIN, { status: 200 });
    },
  });
  const first = await h.call('');
  assert.equal(first.status, 200);
  assert.equal(first.body.stale, false);
  assert.equal(first.body.bulletinDate, '131651Z NOV');
  assert.equal(first.body.inForceCount, 2);
  assert.equal(first.body.warnings.length, 2);
  assert.equal(first.body.warnings[0].id, 'NAVAREA IV 1097/26');
  assert.equal(first.body.warnings[0].category, 'wreck');
  assert.equal(first.body.warnings[1].category, 'live-fire');
  const second = await h.call('');
  assert.equal(second.status, 200);
  assert.equal(calls, 1);
  h.advance(25 * 60 * 60 * 1000);
  await h.call('');
  assert.equal(calls, 2);
});

test('navarea proxy answers 502 with no cache when NGA is down', async () => {
  const h = mount({
    fetchImpl: async () => new Response('down', { status: 503 }),
  });
  const res = await h.call('');
  assert.equal(res.status, 502);
  assert.match(res.body.error, /NGA HTTP 503/);
});

test('navarea proxy serves the stale bulletin when NGA goes down', async () => {
  let calls = 0;
  const h = mount({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(BULLETIN, { status: 200 });
      return new Response('down', { status: 503 });
    },
  });
  assert.equal((await h.call('')).status, 200);
  h.advance(25 * 60 * 60 * 1000);
  const stale = await h.call('');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.warnings.length, 2);
  assert.equal(stale.body.bulletinDate, '131651Z NOV');
});

test('navarea proxy restores the last bulletin from disk without fetching', async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), 'gev-navarea-disk-'));
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    path.join(cacheDir, 'navarea.json'),
    JSON.stringify({
      at: T0 - 60_000,
      bulletinDate: '131651Z NOV',
      inForceCount: 2,
      warnings: [
        {
          id: 'NAVAREA IV 1097/26',
          number: 1097,
          year: 26,
          area: 'CARIBBEAN SEA.',
          text: 'DERELICT VESSEL',
          positions: [{ lat: 17.05, lon: -61.96 }],
          positionParse: true,
          category: 'wreck',
          issuedAt: '131431Z NOV 26',
        },
      ],
    }),
    'utf8',
  );
  let calls = 0;
  const plugin = navareaProxy({
    fetchImpl: async () => {
      calls += 1;
      return new Response('down', { status: 503 });
    },
    now: () => T0,
    warn: () => {},
    cacheDir,
  });
  let handler;
  plugin.configureServer({
    middlewares: {
      use(_path, fn) {
        handler = fn;
      },
    },
  });
  const res = {
    headersSent: false,
    writeHead(status) {
      res.status = status;
      res.headersSent = true;
    },
    end(text) {
      res.body = text;
    },
  };
  await handler({ url: '' }, res);
  assert.equal(res.status, 200);
  assert.equal(calls, 0);
  const body = JSON.parse(res.body);
  assert.equal(body.stale, false);
  assert.equal(body.warnings.length, 1);
});
