import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiSituationSource } from './source.js';

const predictionsPayload = {
  predictions: [
    {
      id: 3,
      rule_id: 'flood-noreaster',
      text: 'Water over the usual first-flood roads by the next high tide.',
      confidence: 0.7,
      source_record_ids: ['news_alert:nws-coastal-1'],
      what_would_change_it: 'Confidence would rise if the next tide reading confirms the curve.',
      created_at: 1794953215000,
      valid_until: 1794974815000,
      outcome: 'open',
    },
  ],
  accuracy: { open: 1, confirmed: 0, wrong: 0 },
};

const statusPayload = {
  writer_enabled: false,
  snapshots: { tides: 1794953215104 },
  accuracy: { open: 1, confirmed: 0, wrong: 0 },
};

function routeFetch(routes) {
  return async (url, options) => {
    const key = url.split('?')[0];
    assert.ok(key in routes, `unexpected url ${url}`);
    const { body, status = 200 } = routes[key];
    if (key === '/api/qa') {
      // GET, not POST: the Node sidecar proxy is GET/HEAD-only.
      assert.equal(options.method, undefined);
      assert.ok(url.includes('question=Is%20flooding%20expected%3F'));
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    };
  };
}

test('getSnapshot merges predictions with the AI status', async () => {
  const source = createAiSituationSource({
    fetchImpl: routeFetch({
      '/api/predictions': { body: predictionsPayload },
      '/api/ai/status': { body: statusPayload },
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.predictions.length, 1);
  assert.equal(snapshot.predictions[0].ruleId, 'flood-noreaster');
  assert.equal(snapshot.accuracy.open, 1);
  assert.equal(snapshot.writerEnabled, false);
  assert.equal(snapshot.snapshots.tides, 1794953215104);
});

test('getSnapshot throws on a non-2xx status', async () => {
  const source = createAiSituationSource({
    fetchImpl: routeFetch({
      '/api/predictions': { body: { error: 'x' }, status: 503 },
      '/api/ai/status': { body: statusPayload },
    }),
  });
  await assert.rejects(() => source.getSnapshot(), /AI situation HTTP 503/);
});

test('getSnapshot throws on a malformed predictions payload', async () => {
  const source = createAiSituationSource({
    fetchImpl: routeFetch({
      '/api/predictions': { body: { accuracy: {} } },
      '/api/ai/status': { body: statusPayload },
    }),
  });
  await assert.rejects(() => source.getSnapshot(), /Malformed predictions/);
});

test('askQuestion POSTs the question and normalizes the answer', async () => {
  const source = createAiSituationSource({
    fetchImpl: routeFetch({
      '/api/qa': {
        body: {
          answer: 'Ocean Avenue is closed by flooding [1].',
          citations: [{ record_id: 'news_item:i1', source: 'Cape May Herald' }],
          confidence: 0.8,
          unofficial: true,
          emergencyNote: 'Call 911 for emergencies',
          retrievedAt: 1794953215449,
        },
      },
    }),
  });
  const answer = await source.askQuestion('Is flooding expected?');
  assert.equal(answer.question, 'Is flooding expected?');
  assert.equal(answer.answer, 'Ocean Avenue is closed by flooding [1].');
  assert.equal(answer.citations[0].recordId, 'news_item:i1');
  assert.equal(answer.confidence, 0.8);
});

test('askQuestion throws on an empty question', async () => {
  const source = createAiSituationSource({ fetchImpl: routeFetch({}) });
  await assert.rejects(() => source.askQuestion('   '), /requires a question/);
});

test('askQuestion throws on a malformed answer', async () => {
  const source = createAiSituationSource({
    fetchImpl: routeFetch({ '/api/qa': { body: { citations: [] } } }),
  });
  await assert.rejects(() => source.askQuestion('Is flooding expected?'), /Malformed Q&A/);
});
