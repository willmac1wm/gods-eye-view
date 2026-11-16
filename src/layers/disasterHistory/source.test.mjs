import assert from 'node:assert/strict';
import test from 'node:test';
import { createDisasterHistorySource } from './source.js';
import { STORM_EVENTS_SNAPSHOT } from './records.js';

const IDA = {
  femaDeclarationString: 'DR-4614-NJ',
  disasterNumber: 4614,
  declarationType: 'DR',
  declarationDate: '2021-09-05T00:00:00.000Z',
  incidentType: 'Hurricane',
  declarationTitle: 'REMNANTS OF HURRICANE IDA',
  paProgramDeclared: true,
  iaProgramDeclared: false,
  hmProgramDeclared: true,
  incidentBeginDate: '2021-09-01T00:00:00.000Z',
  incidentEndDate: '2021-09-03T00:00:00.000Z',
};

function okResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function payload() {
  return {
    fetchedAt: 1_792_000_000_000,
    stale: false,
    ttlMs: 86_400_000,
    fema: {
      metadata: { count: 34 },
      DisasterDeclarationsSummaries: [IDA],
    },
    stormEvents: {
      source: STORM_EVENTS_SNAPSHOT.source,
      sourceFiles: STORM_EVENTS_SNAPSHOT.sourceFiles,
      generated: STORM_EVENTS_SNAPSHOT.generated,
      years: STORM_EVENTS_SNAPSHOT.years,
    },
  };
}

test('getSnapshot returns declarations plus the storm-events summary', async () => {
  const source = createDisasterHistorySource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/disaster-history');
      return okResponse(payload());
    },
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.declarationCount, 34);
  assert.equal(snapshot.declarations[0].id, 'DR-4614-NJ');
  assert.equal(snapshot.stormEvents.summary['2025'].count, 27);
  assert.equal(snapshot.stormEvents.summary['2012'].count, 78);
  assert.equal(snapshot.stale, false);
});

test('getSnapshot throws on HTTP failure and on a malformed payload', async () => {
  const failing = createDisasterHistorySource({
    fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
  });
  await assert.rejects(() => failing.getSnapshot(), /HTTP 502/);
  const malformed = createDisasterHistorySource({
    fetchImpl: async () => okResponse({ fema: null, stormEvents: null }),
  });
  await assert.rejects(() => malformed.getSnapshot(), /Malformed/);
});

test('getSnapshot honors an abort before the fetch', async () => {
  const source = createDisasterHistorySource({
    fetchImpl: async () => okResponse(payload()),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    (error) => error.name === 'AbortError' || /abort/i.test(error.message),
  );
});
