// src/layers/internetOutages/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInternetOutagesLayer } from './index.js';
import { normalizeIodaAlertRow } from './records.js';

function harness({ snapshot = null } = {}) {
  const published = [];
  const visible = [];
  const cleared = [];
  const sources = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        sources.splice(sources.indexOf(value), 1);
      },
    },
  };
  const layer = createInternetOutagesLayer({
    source: {
      getSnapshot: async () => snapshot,
    },
    overlayHost: {
      setEntries(...args) {
        published.push(args);
      },
      setVisible(...args) {
        visible.push(args);
      },
      clearSource(...args) {
        cleared.push(args);
      },
    },
  });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, published, visible, cleared, sources };
}

const CRITICAL_ALERT = normalizeIodaAlertRow({
  datasource: 'bgp',
  entity: { code: '7821', name: 'AS7821 (ZAYO-MN)', type: 'asn' },
  time: 1794822000,
  level: 'critical',
  condition: '< 0.99',
  value: 0,
  historyValue: 37,
  method: 'median',
});

const SNAPSHOT = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 300_000,
  usSummary: [],
  njSummary: [],
  alerts: [CRITICAL_ALERT],
  counts: { usSummary: 0, njSummary: 0, alerts: 1, criticalAlerts: 1 },
};

test('update publishes one county-seat anchor label', async () => {
  const h = harness({ snapshot: SNAPSHOT });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0][0], 'internet-outages');
  assert.equal(h.published[0][1].length, 1);
  assert.match(h.published[0][1][0].title, /Internet outages · NJ quiet/);
  assert.match(h.published[0][1][0].subtitle, /1 critical/);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getAnalystRecords().length, 1);
  assert.equal(h.layer.getAnalystRecords()[0].id, 'IODA-7821-1794822000');
  h.layer.destroy(h.viewer);
});

test('a quiet window is a steady state, not an error', async () => {
  const quiet = {
    ...SNAPSHOT,
    alerts: [],
    counts: { usSummary: 0, njSummary: 0, alerts: 0, criticalAlerts: 0 },
  };
  const h = harness({ snapshot: quiet });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.match(h.published[0][1][0].title, /NJ quiet/);
  assert.equal(h.layer.getStats().count, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the layer usable and records the error', async () => {
  const h = harness({ snapshot: SNAPSHOT });
  assert.equal(await h.layer.update(h.viewer), true);
  const failing = createInternetOutagesLayer({
    source: {
      getSnapshot: async () => {
        throw new Error('Internet outages HTTP 502');
      },
    },
    overlayHost: {
      setEntries(...args) {
        h.published.push(args);
      },
      setVisible(...args) {
        h.visible.push(args);
      },
      clearSource(...args) {
        h.cleared.push(args);
      },
    },
  });
  failing.init(h.viewer);
  failing.enable(h.viewer);
  assert.equal(await failing.update(h.viewer), false);
  assert.match(failing.getStats().error, /Internet outages HTTP 502/);
  failing.destroy(h.viewer);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay', () => {
  const h = harness({ snapshot: SNAPSHOT });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.cleared[0][0], 'internet-outages');
  assert.equal(h.sources.length, 0);
});
