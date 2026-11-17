// src/layers/sanctionsWatch/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSanctionsSource } from './source.js';

const LIVE_CHECK = {
  imo: '9169067',
  vesselName: 'MSC MIA SUMMER II',
  sanctions: { status: 'GREEN', coverageComplete: true, coverageGaps: [] },
  ownership: { opacity: 'HIGH', score: 70 },
  vetting: { grade: 'C', score: 43, status: 'marginal' },
  checkedAt: '2026-11-17T03:19:09.016Z',
  fullReport: 'https://arcnautical.com/check?imo=9169067',
  tier: 'keyless',
};

test('screenVessel hits the same-origin proxy and normalizes the check', async () => {
  const requests = [];
  const source = createSanctionsSource({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(LIVE_CHECK), { status: 200 });
    },
  });
  const screening = await source.screenVessel('9169067');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/sanctions/check?imo=9169067');
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(screening.sanctionsStatus, 'GREEN');
  assert.equal(screening.ownershipScore, 70);
  assert.equal(screening.vettingGrade, 'C');
});

test('screenVessel rejects a bad IMO before any fetch', async () => {
  let calls = 0;
  const source = createSanctionsSource({
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });
  await assert.rejects(() => source.screenVessel('9169068'), /Invalid IMO/);
  await assert.rejects(() => source.screenVessel('nope'), /Invalid IMO/);
  assert.equal(calls, 0);
});

test('screenVessel returns null for an unknown IMO (proxy 404)', async () => {
  const source = createSanctionsSource({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'unknown IMO' }), { status: 404 }),
  });
  assert.equal(await source.screenVessel('9169067'), null);
});

test('screenVessel throws on proxy errors and honors abort', async () => {
  const failing = createSanctionsSource({
    fetchImpl: async () => new Response('boom', { status: 503 }),
  });
  await assert.rejects(() => failing.screenVessel('9169067'), /HTTP 503/);
  const aborted = createSanctionsSource({
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => aborted.screenVessel('9169067', { signal: controller.signal }),
    (err) => err.name === 'AbortError',
  );
});
