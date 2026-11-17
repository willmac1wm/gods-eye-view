import assert from 'node:assert/strict';
import test from 'node:test';
import { createCredibilityLayer } from './index.js';

function harness(source) {
  const events = [];
  const visible = [];
  const cleared = [];
  const layer = createCredibilityLayer({
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
  fetchedAt: 1794800000000,
  stale: false,
  count: 1,
  excludedCount: 0,
  clusters: [
    {
      incidentKey: 'nws-freeze-2026-11-14',
      title: 'Freeze Warning — Cape May County',
      severity: 'Severe',
      credibility: 100,
      band: 'High',
      tier: 1,
      tierLabel: 'Official',
      trend: 'Escalating',
      breakdown: [{ rule: 'highest source tier: Official', points: 90 }],
      sourceCount: 2,
      sources: ['nws_mt_holly_alerts', 'capemay_scanner'],
      lastSeen: 1794800000,
    },
  ],
};

test('update publishes the summary label plus one cluster label', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update({}), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'credibility-scoring');
  const entries = h.events[0][1];
  assert.equal(entries.length, 2);
  assert.match(entries[0].title, /1 scored alert/);
  assert.match(entries[1].title, /100 · High · Escalating/);
  assert.equal(h.layer.getStats().count, 1);
  h.layer.destroy({});
});

test('an empty snapshot publishes the no-scored-alerts label', async () => {
  const h = harness({
    getSnapshot: async () => ({
      fetchedAt: 1,
      stale: false,
      count: 0,
      excludedCount: 0,
      clusters: [],
    }),
  });
  assert.equal(await h.layer.update({}), true);
  assert.match(h.events[0][1][0].title, /No scored alerts/);
  assert.equal(h.layer.getStats().count, 0);
  h.layer.destroy({});
});

test('a failed refresh keeps the last error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('Credibility HTTP 503');
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
  assert.deepEqual(h.cleared.at(-1), ['credibility-scoring']);
  assert.deepEqual(h.visible.at(-1), ['credibility-scoring', false]);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per cluster', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update({});
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].credibility, 100);
  assert.equal(records[0].trend, 'Escalating');
  h.layer.destroy({});
});
