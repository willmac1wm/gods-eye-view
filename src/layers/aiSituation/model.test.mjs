import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAiSituationSummaryEntry,
  getAnalystRecords,
  mapAnalystRecord,
} from './model.js';

const snapshot = {
  predictions: [
    {
      id: 3,
      ruleId: 'flood-noreaster',
      text: 'Water over the usual first-flood roads by the next high tide.',
      confidence: 0.7,
      sourceRecordIds: ['news_alert:nws-coastal-1'],
      whatWouldChangeIt: 'Confidence would rise if the next tide reading confirms the curve.',
      outcome: 'open',
      createdAt: 1794953215000,
      validUntil: 1794974815000,
      checkedAgainst: null,
    },
  ],
  accuracy: { open: 1, confirmed: 2, wrong: 0 },
  writerEnabled: true,
};

test('summary entry carries the latest prediction and the accuracy record', () => {
  const entry = createAiSituationSummaryEntry({ snapshot });
  assert.match(entry.title, /Water over the usual first-flood roads/);
  assert.ok(entry.details.some((detail) => detail.includes('2 confirmed')));
  assert.ok(entry.details.some((detail) => detail.includes('Writer enabled')));
  assert.ok(entry.details.some((detail) => detail.includes('open')));
  assert.equal(entry.id, 'ai-situation');
});

test('summary entry without predictions says so and names the writer state', () => {
  const entry = createAiSituationSummaryEntry({
    snapshot: { predictions: [], accuracy: { open: 0, confirmed: 0, wrong: 0 }, writerEnabled: false },
  });
  assert.match(entry.title, /no predictions yet/);
  assert.ok(
    entry.details.some((detail) => detail.includes('Writer not configured')),
  );
});

test('mapAnalystRecord carries one row per prediction', () => {
  const record = mapAnalystRecord(snapshot.predictions[0], 0);
  assert.equal(record.id, 'AI-PREDICTION-3');
  assert.equal(record.ruleId, 'flood-noreaster');
  assert.equal(record.confidence, 0.7);
  assert.equal(record.outcome, 'open');
  assert.deepEqual(record.sources, ['news_alert:nws-coastal-1']);
  assert.equal(record.source, 'Cape Dispatch AI forecaster');
});

test('getAnalystRecords returns one row per prediction', () => {
  assert.equal(getAnalystRecords(snapshot).length, 1);
  assert.deepEqual(getAnalystRecords({ predictions: [] }), []);
});
