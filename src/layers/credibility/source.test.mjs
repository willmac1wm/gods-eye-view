import assert from 'node:assert/strict';
import test from 'node:test';
import { createCredibilitySource } from './source.js';

const payload = {
  fetchedAt: 1794800000000,
  stale: false,
  count: 1,
  excluded_count: 0,
  clusters: [
    {
      incident_key: 'nws-freeze-2026-11-14',
      title: 'Freeze Warning — Cape May County',
      severity: 'Severe',
      credibility: 100,
      tier: 1,
      tier_label: 'Official',
      trend: 'Escalating',
      breakdown: [{ rule: 'highest source tier: Official', points: 90 }],
      source_count: 2,
      sources: ['nws_mt_holly_alerts', 'capemay_scanner'],
      last_seen: 1794800000,
    },
  ],
};

test('getSnapshot returns the validated snapshot on HTTP 200', async () => {
  const source = createCredibilitySource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.clusters[0].credibility, 100);
  assert.equal(snapshot.clusters[0].band, 'High');
});

test('getSnapshot throws on a non-OK status', async () => {
  const source = createCredibilitySource({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'sidecar down' }),
    }),
  });
  await assert.rejects(() => source.getSnapshot(), /Credibility HTTP 503/);
});

test('getSnapshot throws on a malformed payload', async () => {
  const source = createCredibilitySource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ clusters: 'not-an-array' }),
    }),
  });
  await assert.rejects(
    () => source.getSnapshot(),
    /Malformed credibility response/,
  );
});

test('getSnapshot respects an aborted signal', async () => {
  const source = createCredibilitySource({
    fetchImpl: async (_url, { signal } = {}) => {
      signal?.throwIfAborted();
      return { ok: true, status: 200, json: async () => payload };
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (error) => error.name === 'AbortError' || /abort/i.test(error.message),
  );
});
