import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createSessionToken, saveAccountStore } from './auth.js';
import {
  WATCH_MAX_PLACES,
  createWatchHandler,
  incidentsFrom,
  insideRings,
  loadWatchStore,
  milesBetween,
  planAlerts,
  pushKeys,
  runWatchSweep,
  saveWatchStore,
} from './watchList.js';

const NOW = Date.parse('2026-11-18T15:00:00Z');
const HOME = { lat: 38.9874, lon: -74.825 }; // 4600 Park Blvd, Wildwood
const SECRET = 'test-session-secret-0123456789abcdef';

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-watch-'));
  const env = { GEV_DATA_DIR: dir, SESSION_SECRET: SECRET };
  saveAccountStore(
    {
      nextId: 3,
      accounts: [
        {
          id: 1,
          username: 'alice',
          email: 'alice@capemay.test',
          role: 'member',
        },
        { id: 2, username: 'bob', email: 'bob@capemay.test', role: 'member' },
      ],
    },
    env,
  );
  return { dir, env };
}

const cookieFor = (env, user) =>
  `gev_session=${encodeURIComponent(createSessionToken(user, { env }))}`;

function req({ method = 'GET', url, cookie, body, type = 'application/json' }) {
  const stream = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    ...(cookie ? { cookie } : {}),
    ...(body ? { 'content-type': type } : {}),
  };
  stream.socket = { remoteAddress: '127.0.0.1' };
  return stream;
}

function res() {
  return {
    status: 0,
    body: '',
    writableEnded: false,
    writeHead(status) {
      this.status = status;
    },
    end(chunk = '') {
      this.body = String(chunk);
      this.writableEnded = true;
    },
  };
}

const census = (match) => async () => ({
  ok: true,
  json: async () => ({
    result: {
      addressMatches: match
        ? [
            {
              matchedAddress: '4600 PARK BLVD, WILDWOOD, NJ, 08260',
              coordinates: { x: HOME.lon, y: HOME.lat },
            },
          ]
        : [],
    },
  }),
});

async function call(handle, options) {
  const r = res();
  const handled = await handle(req(options), r);
  return {
    handled,
    status: r.status,
    body: r.body ? JSON.parse(r.body) : null,
  };
}

test('distance and polygon checks', () => {
  // Wildwood to Cape May Court House is about 6.6 miles.
  const miles = milesBetween(HOME, { lat: 39.0826, lon: -74.8238 });
  assert.ok(miles > 6 && miles < 7.2, String(miles));
  const box = [
    [
      [-74.9, 38.9],
      [-74.7, 38.9],
      [-74.7, 39.1],
      [-74.9, 39.1],
      [-74.9, 38.9],
    ],
  ];
  assert.equal(insideRings(HOME, box), true);
  assert.equal(insideRings({ lat: 39.3, lon: -74.5 }, box), false);
});

test('incidents: calls, traffic, reports, flooding gauges and warnings; old and minor items left out', () => {
  const recent = new Date(NOW - 10 * 60_000).toISOString();
  const old = new Date(NOW - 5 * 3600_000).toISOString();
  const point = (lat, lon) => ({ type: 'Point', lat, lon });
  const incidents = incidentsFrom(
    {
      calls: {
        features: [
          {
            id: 'call:1',
            title: 'Structure fire',
            location: 'Park Blvd',
            municipality: 'Wildwood',
            observedAt: recent,
            geometry: point(38.988, -74.826),
          },
          {
            id: 'call:old',
            title: 'Old call',
            observedAt: old,
            geometry: point(38.988, -74.826),
          },
        ],
      },
      traffic: {
        features: [
          {
            id: 'tomtom:9',
            title: 'Crash',
            road: 'Rio Grande Ave',
            observedAt: recent,
            geometry: point(38.99, -74.82),
          },
        ],
      },
      reports: {
        features: [
          {
            id: 'report:3',
            title: 'Community report · flooding',
            status: 'unverified',
            observedAt: recent,
            geometry: point(38.98, -74.83),
          },
        ],
      },
      gauges: {
        features: [
          {
            id: 'g:1',
            title: 'Grassy Sound',
            observedAt: recent,
            observed: { category: 'minor' },
            geometry: point(39.0, -74.8),
          },
          {
            id: 'g:2',
            title: 'Ocean City',
            observedAt: recent,
            observed: { category: 'action' },
            geometry: point(39.27, -74.6),
          },
        ],
      },
      alerts: {
        features: [
          {
            id: 'nws:a',
            title: 'Coastal Flood Warning',
            expires: '2026-11-18T23:00:00Z',
            geometry: {
              type: 'Polygon',
              rings: [
                [
                  [-75, 38.8],
                  [-74.6, 38.8],
                  [-74.6, 39.2],
                  [-75, 39.2],
                  [-75, 38.8],
                ],
              ],
            },
          },
          {
            id: 'nws:b',
            title: 'Coastal Flood Advisory',
            geometry: {
              type: 'Polygon',
              rings: [
                [
                  [-75, 38.8],
                  [-74.6, 38.8],
                  [-74.6, 39.2],
                  [-75, 38.8],
                ],
              ],
            },
          },
        ],
      },
    },
    NOW,
  );
  assert.deepEqual(incidents.map((i) => i.id).sort(), [
    'call:1',
    'g:1',
    'nws:a',
    'report:3',
    'tomtom:9',
  ]);
  const warning = incidents.find((i) => i.id === 'nws:a');
  assert.match(warning.detail, /^until Wed 6:00 PM$/);
  assert.equal(incidents.find((i) => i.id === 'g:1').title, 'Minor flooding');
});

test('alerts go to places in range, once, without the address, capped per hour', () => {
  const device = {
    subscription: {
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'p', auth: 'a' },
    },
  };
  const store = {
    members: {
      1: {
        places: [
          {
            id: 'p-home',
            label: 'Home',
            name: null,
            address: '4600 PARK BLVD',
            lat: HOME.lat,
            lon: HOME.lon,
            radiusMiles: 0.5,
          },
        ],
        devices: [device],
        sent: {},
      },
      2: {
        places: [
          {
            id: 'p-bob',
            label: 'Home',
            lat: HOME.lat,
            lon: HOME.lon,
            radiusMiles: 5,
          },
        ],
        devices: [],
        sent: {},
      },
    },
  };
  const near = {
    id: 'call:1',
    kind: 'call',
    title: 'Structure fire',
    detail: 'Park Blvd',
    at: { lat: 38.99, lon: -74.826 },
  };
  const far = {
    id: 'call:2',
    kind: 'call',
    title: 'Far call',
    detail: '',
    at: { lat: 39.08, lon: -74.82 },
  };
  const area = {
    id: 'nws:a',
    kind: 'warning',
    title: 'Coastal Flood Warning',
    detail: '',
    rings: [
      [
        [-75, 38.8],
        [-74.6, 38.8],
        [-74.6, 39.2],
        [-75, 39.2],
        [-75, 38.8],
      ],
    ],
  };

  const first = planAlerts(store, [near, far, area], NOW);
  assert.deepEqual(
    first.map((p) => p.payload.tag),
    ['p-home|call:1', 'p-home|nws:a'],
  );
  assert.ok(
    first.every((p) => p.member === '1'),
    'no devices, no alerts',
  );
  assert.match(first[0].payload.title, /^Near Home · 0\.\d\d mi away$/);
  assert.equal(first[0].payload.body, 'Structure fire · Park Blvd');
  assert.equal(first[1].payload.title, 'Near Home · inside the area');
  assert.ok(
    !JSON.stringify(first).includes('PARK BLVD'),
    'the address never goes in a push',
  );

  assert.deepEqual(
    planAlerts(store, [near, far, area], NOW + 60_000),
    [],
    'never twice',
  );

  const many = Array.from({ length: 12 }, (_, i) => ({
    ...near,
    id: `call:m${i}`,
  }));
  const capped = planAlerts(store, many, NOW + 120_000);
  assert.equal(capped.length, 6, '8 per hour, 2 already sent');
  assert.equal(
    Object.values(store.members[1].sent).filter((v) => v < 0).length,
    6,
    'the rest recorded quietly',
  );
});

test('routes: sign-in required, JSON only, add/update/remove places, one member cannot touch another', async () => {
  const { dir, env } = tempEnv();
  try {
    const handle = createWatchHandler({
      env,
      now: () => NOW,
      fetchImpl: census(true),
    });
    const alice = cookieFor(env, {
      id: 1,
      username: 'alice',
      email: 'alice@capemay.test',
    });
    const bob = cookieFor(env, {
      id: 2,
      username: 'bob',
      email: 'bob@capemay.test',
    });

    assert.equal((await call(handle, { url: '/api/other' })).handled, false);
    assert.equal((await call(handle, { url: '/api/watch' })).status, 401);
    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/places',
          cookie: alice,
          body: { label: 'Home', address: 'x' },
          type: 'text/plain',
        })
      ).status,
      415,
    );

    const empty = await call(handle, { url: '/api/watch', cookie: alice });
    assert.deepEqual(empty.body.places, []);
    assert.deepEqual(empty.body.radii, [0.1, 0.25, 0.5, 0.75, 1, 2, 5]);
    assert.ok(empty.body.pushKey.length > 60);

    const added = await call(handle, {
      method: 'POST',
      url: '/api/watch/places',
      cookie: alice,
      body: {
        label: 'Second home',
        name: 'Shore house',
        address: '4600 Park Blvd, Wildwood NJ',
        radiusMiles: 0.25,
      },
    });
    assert.equal(added.status, 200);
    assert.equal(
      added.body.place.address,
      '4600 PARK BLVD, WILDWOOD, NJ, 08260',
    );
    assert.equal(added.body.place.radiusMiles, 0.25);
    const id = added.body.place.id;

    const here = await call(handle, {
      method: 'POST',
      url: '/api/watch/places',
      cookie: alice,
      body: { label: 'Family', lat: 39.0, lon: -74.8, radiusMiles: 1 },
    });
    assert.equal(here.body.places.length, 2);

    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/places',
          cookie: alice,
          body: { label: 'Home', address: 'x', radiusMiles: 3 },
        })
      ).status,
      400,
      'only listed distances',
    );
    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/places',
          cookie: alice,
          body: { label: 'Boat', address: 'x' },
        })
      ).status,
      400,
      'only listed labels',
    );
    const notFound = await call(
      createWatchHandler({ env, fetchImpl: census(false) }),
      {
        method: 'POST',
        url: '/api/watch/places',
        cookie: alice,
        body: { label: 'Home', address: 'Nowhere St' },
      },
    );
    assert.equal(notFound.status, 404);

    const changed = await call(handle, {
      method: 'POST',
      url: `/api/watch/places/${id}`,
      cookie: alice,
      body: { radiusMiles: 1 },
    });
    assert.equal(changed.body.place.radiusMiles, 1);

    // Bob sees nothing of Alice's and cannot change or remove her places.
    assert.deepEqual(
      (await call(handle, { url: '/api/watch', cookie: bob })).body.places,
      [],
    );
    assert.equal(
      (
        await call(handle, {
          method: 'DELETE',
          url: `/api/watch/places/${id}`,
          cookie: bob,
          body: {},
        })
      ).status,
      404,
    );

    const removed = await call(handle, {
      method: 'DELETE',
      url: `/api/watch/places/${id}`,
      cookie: alice,
      body: {},
    });
    assert.equal(removed.body.places.length, 1);

    // The store file is private to the server user.
    const mode = fs.statSync(path.join(dir, 'watch-list.json')).mode & 0o777;
    if (process.platform !== 'win32') assert.equal(mode, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a member can watch at most the maximum number of places', async () => {
  const { dir, env } = tempEnv();
  try {
    const handle = createWatchHandler({ env, fetchImpl: census(true) });
    const alice = cookieFor(env, { id: 1, username: 'alice' });
    for (let i = 0; i < WATCH_MAX_PLACES; i++)
      assert.equal(
        (
          await call(handle, {
            method: 'POST',
            url: '/api/watch/places',
            cookie: alice,
            body: { label: 'Other', lat: 39, lon: -74.8 },
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/places',
          cookie: alice,
          body: { label: 'Other', lat: 39, lon: -74.8 },
        })
      ).status,
      400,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('devices: valid subscriptions only; a test alert is sent and a gone device is forgotten', async () => {
  const { dir, env } = tempEnv();
  try {
    const sent = [];
    const sender = async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      if (sub.endpoint.endsWith('/gone'))
        throw Object.assign(new Error('gone'), { statusCode: 410 });
    };
    const handle = createWatchHandler({ env, sender });
    const alice = cookieFor(env, { id: 1, username: 'alice' });
    const sub = (endpoint) => ({
      subscription: { endpoint, keys: { p256dh: 'BPk', auth: 'au' } },
    });
    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/test',
          cookie: alice,
          body: {},
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(handle, {
          method: 'POST',
          url: '/api/watch/devices',
          cookie: alice,
          body: sub('http://insecure.example/x'),
        })
      ).status,
      400,
    );
    await call(handle, {
      method: 'POST',
      url: '/api/watch/devices',
      cookie: alice,
      body: sub('https://push.example/ok'),
    });
    const two = await call(handle, {
      method: 'POST',
      url: '/api/watch/devices',
      cookie: alice,
      body: sub('https://push.example/gone'),
    });
    assert.equal(two.body.devices, 2);
    const tested = await call(handle, {
      method: 'POST',
      url: '/api/watch/test',
      cookie: alice,
      body: {},
    });
    assert.equal(sent.length, 2);
    assert.equal(sent[0].payload.kind, 'test');
    assert.equal(tested.body.devices, 1, 'the gone device was dropped');
    const off = await call(handle, {
      method: 'DELETE',
      url: '/api/watch/devices',
      cookie: alice,
      body: { endpoint: 'https://push.example/ok' },
    });
    assert.equal(off.body.devices, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the sweep alerts members and drops members whose account was deleted', async () => {
  const { dir, env } = tempEnv();
  try {
    const device = {
      subscription: {
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p', auth: 'a' },
      },
    };
    saveWatchStore(
      {
        version: 1,
        members: {
          1: {
            places: [
              {
                id: 'p1',
                label: 'Home',
                lat: HOME.lat,
                lon: HOME.lon,
                radiusMiles: 0.5,
              },
            ],
            devices: [device],
            sent: {},
          },
          99: {
            places: [
              {
                id: 'p9',
                label: 'Home',
                lat: HOME.lat,
                lon: HOME.lon,
                radiusMiles: 5,
              },
            ],
            devices: [device],
            sent: {},
          },
        },
      },
      env,
    );
    const sent = [];
    const count = await runWatchSweep({
      env,
      now: NOW,
      sender: async (sub, payload) => sent.push(JSON.parse(payload)),
      loadEnvelopes: async () => ({
        calls: {
          features: [
            {
              id: 'call:7',
              title: 'Brush fire',
              observedAt: new Date(NOW - 60_000).toISOString(),
              geometry: { type: 'Point', lat: 38.988, lon: -74.826 },
            },
          ],
        },
      }),
    });
    assert.equal(count, 1);
    assert.equal(sent[0].title.startsWith('Near Home'), true);
    assert.deepEqual(
      Object.keys(loadWatchStore(env).members),
      ['1'],
      'account 99 does not exist',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('push keys are made once and kept privately', () => {
  const { dir, env } = tempEnv();
  try {
    const a = pushKeys(env);
    const b = pushKeys(env);
    assert.equal(a.publicKey, b.publicKey);
    const mode =
      fs.statSync(path.join(dir, 'watch-push-keys.json')).mode & 0o777;
    if (process.platform !== 'win32') assert.equal(mode, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
