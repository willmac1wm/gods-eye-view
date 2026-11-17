import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accuracyLabel,
  normalizeAiStatus,
  normalizePrediction,
  normalizePredictionsSnapshot,
  normalizeQaAnswer,
  predictionStatusLabel,
  validatePredictionsSnapshot,
  validateQaAnswer,
} from './records.js';

test('normalizeQaAnswer keeps the answer, citations, and confidence', () => {
  const answer = normalizeQaAnswer({
    answer: 'Ocean Avenue is closed by flooding [1].',
    citations: [
      {
        record_id: 'news_item:i1',
        source: 'Cape May Herald',
        url: 'https://example.test/i1',
        snippet: 'Water over the road.',
        claim: 'Ocean Avenue is closed',
      },
    ],
    confidence: 0.8,
    unofficial: true,
    emergencyNote: 'Call 911 for emergencies',
    retrievedAt: 1794953215449,
  });
  assert.equal(answer.answer, 'Ocean Avenue is closed by flooding [1].');
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.citations[0].recordId, 'news_item:i1');
  assert.equal(answer.confidence, 0.8);
  assert.equal(answer.unofficial, true);
});

test('normalizeQaAnswer drops a malformed citation and keeps the rest', () => {
  const answer = normalizeQaAnswer({
    answer: 'Something.',
    citations: [{ record_id: 'news_item:i1' }, { source: 'no id' }],
    confidence: 0.5,
  });
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.citations[0].recordId, 'news_item:i1');
});

test('normalizeQaAnswer accepts the no-record answer with closest topics', () => {
  const answer = normalizeQaAnswer({
    answer: "I don't have a record of that",
    citations: [],
    confidence: null,
    unofficial: true,
    emergencyNote: 'Call 911 for emergencies',
    retrievedAt: 1794953215456,
    closest_topics: [{ title: 'Coastal Flood Advisory', record_id: 'news_alerts' }],
  });
  assert.equal(validateQaAnswer(answer).answer, "I don't have a record of that");
  assert.equal(answer.closestTopics[0].title, 'Coastal Flood Advisory');
});

test('normalizeQaAnswer returns null without an answer', () => {
  assert.equal(normalizeQaAnswer({ citations: [] }), null);
  assert.equal(normalizeQaAnswer(null), null);
  assert.equal(validateQaAnswer(null), null);
});

test('normalizePrediction keeps the rule, confidence, sources, and outcome', () => {
  const pred = normalizePrediction({
    id: 3,
    rule_id: 'flood-noreaster',
    text: 'Water over the usual first-flood roads by the next high tide.',
    confidence: 0.7,
    source_record_ids: ['news_alert:nws-coastal-1', 'fact:nws_minor_flood_ft'],
    what_would_change_it: 'Confidence would rise if the next tide reading confirms the curve.',
    created_at: 1794953215000,
    valid_until: 1794974815000,
    outcome: 'open',
    checked_at: null,
    checked_against: null,
  });
  assert.equal(pred.ruleId, 'flood-noreaster');
  assert.equal(pred.confidence, 0.7);
  assert.deepEqual(pred.sourceRecordIds, [
    'news_alert:nws-coastal-1',
    'fact:nws_minor_flood_ft',
  ]);
  assert.equal(pred.outcome, 'open');
});

test('normalizePrediction defaults an unknown outcome to open', () => {
  const pred = normalizePrediction({ text: 'x', outcome: 'pending' });
  assert.equal(pred.outcome, 'open');
});

test('normalizePrediction returns null without text', () => {
  assert.equal(normalizePrediction({ rule_id: 'flood-noreaster' }), null);
});

test('normalizePredictionsSnapshot keeps the accuracy record', () => {
  const snapshot = normalizePredictionsSnapshot({
    predictions: [{ text: 'x', outcome: 'confirmed' }],
    accuracy: { open: 2, confirmed: 3, wrong: 1 },
  });
  assert.equal(validatePredictionsSnapshot(snapshot).predictions.length, 1);
  assert.deepEqual(snapshot.accuracy, { open: 2, confirmed: 3, wrong: 1 });
});

test('normalizePredictionsSnapshot returns null without a predictions array', () => {
  assert.equal(normalizePredictionsSnapshot({ accuracy: {} }), null);
});

test('normalizeAiStatus keeps writer state and snapshot coverage', () => {
  const status = normalizeAiStatus({
    writer_enabled: false,
    snapshots: { tides: 1794953215104 },
    accuracy: { open: 1, confirmed: 0, wrong: 0 },
  });
  assert.equal(status.writerEnabled, false);
  assert.equal(status.snapshots.tides, 1794953215104);
  assert.equal(status.accuracy.open, 1);
});

test('accuracyLabel counts confirmed, wrong, and open', () => {
  assert.equal(accuracyLabel({ open: 2, confirmed: 3, wrong: 1 }), '3 confirmed · 1 wrong · 2 open');
  assert.equal(accuracyLabel({ open: 0, confirmed: 0, wrong: 0 }), 'No predictions yet');
  assert.equal(accuracyLabel(null), 'No predictions yet');
});

test('predictionStatusLabel marks the mil-surge note uncheckable', () => {
  assert.equal(predictionStatusLabel({ outcome: 'confirmed' }), 'confirmed');
  assert.equal(predictionStatusLabel({ outcome: 'wrong' }), 'wrong');
  assert.equal(
    predictionStatusLabel({ outcome: 'open', ruleId: 'mil-surge-pattern' }),
    'open — outcome uncheckable',
  );
  assert.equal(
    predictionStatusLabel({
      outcome: 'open',
      ruleId: 'flood-noreaster',
      checkedAgainst: 'outcome uncheckable — still open',
    }),
    'open — outcome uncheckable',
  );
  assert.equal(predictionStatusLabel({ outcome: 'open' }), 'open');
});
