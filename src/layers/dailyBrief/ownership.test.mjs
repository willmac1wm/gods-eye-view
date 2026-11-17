import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailyBriefLayer } from './index.js';

function harness(source) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createDailyBriefLayer({
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
  brief: {
    id: 2,
    slug: 'daily-brief-2026-11-17',
    date: '2026-11-17',
    dateLabel: 'Nov. 17, 2026',
    headline: 'Cape May County — Daily Brief, Nov. 17, 2026',
    status: 'published',
    confidence: 0.9,
    stale: false,
    sections: [
      { heading: 'What happened', text: 'A freeze warning is in effect.' },
      { heading: 'Still active', text: 'The warning remains in effect.' },
      { heading: 'What to watch', text: 'The advisory runs to Tuesday.' },
    ],
  },
  writerEnabled: true,
};

test('update publishes one summary label for the latest brief', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'daily-brief');
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].title, /Daily Brief, Nov\. 17, 2026/);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().status, 'published');
  h.layer.destroy({});
});

test('row controls list the three sections', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const controls = h.layer.getRowControls();
  assert.match(controls.info, /Daily Brief, Nov\. 17, 2026/);
  assert.match(controls.info, /90%/);
  assert.equal(controls.list.items.length, 3);
  assert.deepEqual(
    controls.list.items.map((i) => i.lead),
    ['What happened', 'Still active', 'What to watch'],
  );
  h.layer.destroy({});
});

test('row controls with no brief and no writer say the writer is not configured', async () => {
  const h = harness({
    getSnapshot: async () => ({ brief: null, writerEnabled: false }),
  });
  await h.layer.update({});
  assert.match(h.layer.getRowControls().info, /writer not configured/);
  assert.equal(h.layer.getRowControls().list, null);
  h.layer.destroy({});
});

test('a failed refresh keeps the last error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('Daily brief HTTP 503');
    },
  });
  assert.equal(await h.layer.update({}), false);
  assert.match(h.layer.getStats().error, /503/);
  assert.equal(h.events.length, 0);
  h.layer.destroy({});
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init({}), /already initialized/);
  h.layer.destroy({});
  assert.deepEqual(h.cleared.at(-1), ['daily-brief']);
  assert.deepEqual(h.visible.at(-1), ['daily-brief', false]);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row for the latest brief', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'DAILY-BRIEF-daily-brief-2026-11-17');
  assert.equal(records[0].confidence, 0.9);
  h.layer.destroy({});
});
