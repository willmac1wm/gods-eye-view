import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiSituationLayer } from './index.js';

function harness(source) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createAiSituationLayer({
    source,
    overlayHost: {
      setEntries(...args) {
        events.push(args);
      },
      setVisible(...args) {
        visible.push(args);
      },
      clearSource(...args) {
        cleared.push(args);
      },
    },
  });
  layer.init({});
  layer.enable({});
  return { layer, events, visible, cleared };
}

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

const qaAnswer = {
  question: 'Is flooding expected?',
  answer: 'Ocean Avenue is closed by flooding [1].',
  citations: [{ recordId: 'news_item:i1', source: 'Cape May Herald' }],
  confidence: 0.8,
  unofficial: true,
  emergencyNote: 'Call 911 for emergencies',
  retrievedAt: 1794953215449,
  closestTopics: [],
};

test('update publishes one summary label for the latest prediction', async () => {
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async () => qaAnswer,
  });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'ai-situation');
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].title, /Water over the usual first-flood roads/);
  assert.equal(h.layer.getStats().count, 1);
  h.layer.destroy({});
});

test('row controls offer the suggested questions as chips', async () => {
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async () => qaAnswer,
  });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.equal(controls.chips.length, 4);
  assert.equal(controls.chips[1].params.question, 'Is flooding expected?');
  assert.match(controls.info, /2 confirmed/);
  assert.match(controls.infoTitle, /Unofficial/);
  assert.match(controls.infoTitle, /Call 911/);
  assert.equal(controls.list.items[0].lead, 'Prediction · open');
  h.layer.destroy({});
});

test('setParams asks the question and renders the answer with citations', async () => {
  const asked = [];
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async (question) => {
      asked.push(question);
      return { ...qaAnswer, question };
    },
  });
  await h.layer.update({});
  assert.equal(h.layer.setParams({ question: 'Is flooding expected?' }), true);
  // The ask is async: the panel shows the loading row first.
  assert.match(h.layer.getRowControls().list.items[0].text, /Asking/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const controls = h.layer.getRowControls();
  assert.deepEqual(asked, ['Is flooding expected?']);
  assert.equal(controls.list.items[0].lead, 'Is flooding expected?');
  assert.match(controls.list.items[0].text, /Ocean Avenue is closed/);
  assert.equal(controls.list.items[1].lead, 'Source');
  assert.match(controls.list.items[1].text, /Cape May Herald/);
  h.layer.destroy({});
});

test('setParams rejects an empty question', async () => {
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async () => qaAnswer,
  });
  assert.equal(h.layer.setParams({}), false);
  assert.equal(h.layer.setParams({ question: '   ' }), false);
  h.layer.destroy({});
});

test('a no-record answer renders the closest stored topics', async () => {
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async (question) => ({
      question,
      answer: "I don't have a record of that",
      citations: [],
      confidence: null,
      unofficial: true,
      emergencyNote: 'Call 911 for emergencies',
      retrievedAt: 1794953215449,
      closestTopics: [{ title: 'Coastal Flood Advisory', recordId: 'news_alerts' }],
    }),
  });
  await h.layer.update({});
  h.layer.setParams({ question: 'zebra migration patterns' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const items = h.layer.getRowControls().list.items;
  assert.match(items[0].text, /don't have a record/);
  assert.equal(items[1].lead, 'Closest stored topic');
  assert.equal(items[1].text, 'Coastal Flood Advisory');
  h.layer.destroy({});
});

test('analyst records carry one row per prediction', async () => {
  const h = harness({
    getSnapshot: async () => snapshot,
    askQuestion: async () => qaAnswer,
  });
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'AI-PREDICTION-3');
  assert.equal(records[0].ruleId, 'flood-noreaster');
  h.layer.destroy({});
});
