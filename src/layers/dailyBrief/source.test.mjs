import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyBriefSource } from './source.js';

const payload = {
  brief: {
    id: 2,
    slug: 'daily-brief-2026-11-17',
    headline: 'Cape May County — Daily Brief, Nov. 17, 2026',
    body_md: '## What happened\n\nSomething happened.',
    status: 'published',
    confidence: 0.9,
    updated_at: Math.floor(Date.now() / 1000),
  },
  writer_enabled: false,
};

function okFetch(body, status = 200) {
  return async (url, options) => {
    assert.equal(url, '/api/news/brief');
    assert.equal(options.cache, 'no-store');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

test('getSnapshot returns the normalized brief plus writer_enabled', async () => {
  const source = createDailyBriefSource({ fetchImpl: okFetch(payload) });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.brief.slug, 'daily-brief-2026-11-17');
  assert.equal(snapshot.brief.sections.length, 1);
  assert.equal(snapshot.writerEnabled, false);
});

test('getSnapshot accepts a null brief (nothing written yet)', async () => {
  const source = createDailyBriefSource({
    fetchImpl: okFetch({ brief: null, writer_enabled: true }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.brief, null);
  assert.equal(snapshot.writerEnabled, true);
});

test('getSnapshot throws on a non-2xx status', async () => {
  const source = createDailyBriefSource({
    fetchImpl: okFetch({ error: 'x' }, 503),
  });
  await assert.rejects(() => source.getSnapshot(), /Daily brief HTTP 503/);
});

test('getSnapshot throws on a malformed payload', async () => {
  const source = createDailyBriefSource({
    fetchImpl: okFetch({ brief: { status: 'published' } }),
  });
  await assert.rejects(() => source.getSnapshot(), /Malformed daily brief/);
});

test('getSnapshot honors an aborted signal', async () => {
  const source = createDailyBriefSource({ fetchImpl: okFetch(payload) });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    /aborted/i,
  );
});
