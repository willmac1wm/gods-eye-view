// src/layers/fishing/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFishingLayer } from './index.js';
import { createFishingSource } from './source.js';

function harness({ records = [] } = {}) {
  const sources = [];
  const events = [];
  const visible = [];
  const cleared = [];
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
  const layer = createFishingLayer({
    source: createFishingSource({
      vessels: { getAnalystRecords: () => records },
    }),
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
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, visible, cleared };
}

const FISHING = {
  mmsi: '367123456',
  name: 'SEA HARVEST',
  lat: 39.1,
  lon: -74.9,
  speedKts: 4.2,
  courseDeg: 180,
  shipType: '30',
  lastPositionEpoch: 1_793_123_456_789,
};

test('update publishes one label per fishing vessel present', async () => {
  const h = harness({ records: [FISHING] });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'fishing-activity');
  assert.match(h.events[0][1][0].title, /SEA HARVEST · 4\.2 kn/);
  assert.match(h.events[0][1][0].subtitle, /Fishing vessel present/);
  assert.equal(h.layer.getStats().count, 1);
  h.layer.destroy(h.viewer);
});

test('zero fishing vessels is a steady state, not an error', async () => {
  const h = harness({ records: [] });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.events[0][1], []);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.layer.getStats().error, null);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['fishing-activity']);
  assert.deepEqual(h.visible.at(-1), ['fishing-activity', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per fishing vessel present', async () => {
  const h = harness({ records: [FISHING] });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].mmsi, '367123456');
  assert.equal(records[0].name, 'SEA HARVEST');
  assert.equal(records[0].shipType, '30');
  assert.equal(records[0].speedKts, 4.2);
  h.layer.destroy(h.viewer);
});

test('a failing presence source marks the error and returns false', async () => {
  const h = harness();
  h.layer.destroy(h.viewer);
  const broken = createFishingLayer({
    source: {
      getPresence: () => {
        throw new Error('presence failed');
      },
    },
    overlayHost: {
      setEntries: () => {},
      setVisible: () => {},
      clearSource: () => {},
    },
  });
  broken.init(h.viewer);
  broken.enable(h.viewer);
  assert.equal(await broken.update(h.viewer), false);
  assert.match(broken.getStats().error, /presence failed/);
  broken.destroy(h.viewer);
});
