import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialHandler, normalizeSocialItem } from './social.js';

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
    },
  };
  return res;
}

// Sidecar-shaped /api/news/latest payload; cape upstream absent.
function sidecarFetch() {
  const payload = {
    count: 2,
    items: [
      {
        id: 'abc123',
        source_id: 'gnews_capemay',
        source_name: 'Cape May County media',
        kind: 'media',
        title: 'Questions in Sea Isle Over Agreement With Ocean City',
        url: 'https://example.com/sea-isle',
        summary: 'Council questions the agreement.',
        publisher: 'Cape May County Herald',
        published: 'Nov 15, 2026',
        pub_ms: 1794800631000,
      },
      {
        id: 'def456',
        source_id: 'press_of_ac',
        source_name: 'Press of Atlantic City',
        kind: 'media',
        title: 'Watch Ocean City receive state championship trophy',
        url: 'https://example.com/trophy',
        summary: 'Trophy presentation.',
        publisher: 'Press of Atlantic City',
        published: 'Nov 15, 2026',
        pub_ms: 1794799380000,
      },
    ],
  };
  return async (url) => {
    const u = String(url);
    assert.match(u, /127\.0\.0\.1:8120\/api\/news\/latest\?limit=50/);
    return {
      ok: true,
      headers: { get: () => null },
      body: { cancel: async () => {} },
      text: async () => JSON.stringify(payload),
    };
  };
}

test('social handler serves news from the sidecar, not the cape upstream', async () => {
  const handler = createSocialHandler({
    fetchImpl: sidecarFetch(),
    resolveUpstream: () => null,
    resolveSidecar: () => 'http://127.0.0.1:8120',
  });
  const res = fakeRes();
  await handler(
    { method: 'GET', url: '/?kind=news', socket: { remoteAddress: '127.0.0.1' } },
    res,
  );
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(String(res.body));
  assert.equal(body.kind, 'news');
  assert.equal(body.count, 2);
  assert.equal(body.items[0].source, 'news');
  assert.equal(
    body.items[0].title,
    'Questions in Sea Isle Over Agreement With Ocean City',
  );
  assert.equal(body.items[0].body, 'Council questions the agreement.');
  assert.equal(body.items[0].url, 'https://example.com/sea-isle');
  // pub_ms becomes the item timestamp, newest first.
  assert.equal(body.items[0].at, '2026-11-16T03:43:51.000Z');
  assert.equal(body.items[1].at, '2026-11-16T03:23:00.000Z');
  assert.equal(body.sources.news, true);
  assert.equal(body.sources.sidecar, true);
  assert.equal(body.sources.firewire, false);
});

test('social handler degrades to empty news when the sidecar is down', async () => {
  const handler = createSocialHandler({
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    resolveUpstream: () => null,
    resolveSidecar: () => 'http://127.0.0.1:8120',
  });
  const res = fakeRes();
  await handler(
    { method: 'GET', url: '/?kind=news', socket: { remoteAddress: '127.0.0.1' } },
    res,
  );
  // No cape upstream and no sidecar: the desk reports quiet, not a 502.
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(String(res.body));
  assert.equal(body.count, 0);
  assert.equal(body.sources.news, false);
  assert.equal(body.sources.sidecar, true);
});

test('normalizeSocialItem maps board wire and detects platform', () => {
  const item = normalizeSocialItem(
    {
      title: 'Rip current alert',
      town: 'Wildwood',
      source: 'NWS',
      url: 'https://x.com/NWS/status/1',
      created_at: '2026-11-05T12:00:00Z',
    },
    'board-wire',
  );
  assert.equal(item.platform, 'x');
  assert.equal(item.town, 'Wildwood');
  assert.equal(item.title, 'Rip current alert');
  assert.ok(item.id);
});

test('normalizeSocialItem rejects empty payloads', () => {
  assert.equal(normalizeSocialItem({}), null);
  assert.equal(normalizeSocialItem(null), null);
});
