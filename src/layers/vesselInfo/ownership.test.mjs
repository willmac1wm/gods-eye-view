// src/layers/vesselInfo/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVesselInfoLayer } from './index.js';
import { createVesselInfoSource } from './source.js';

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
  const layer = createVesselInfoLayer({
    source: createVesselInfoSource({
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

const VESSEL = {
  mmsi: '368889000',
  name: 'USNS BIG HORN',
  imo: '8812162',
  lat: 1.23,
  lon: 103.42,
  speedKts: 12,
  shipType: 'Tanker',
  lastPositionEpoch: 1_793_123_456_789,
};

test('update stores backgrounds and publishes no map pins', async () => {
  const h = harness({ records: [VESSEL] });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'vessel-info');
  assert.deepEqual(h.events[0][1], []);
  assert.equal(h.layer.getStats().count, 1);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['vessel-info']);
  assert.deepEqual(h.visible.at(-1), ['vessel-info', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry the background links', async () => {
  const h = harness({ records: [VESSEL] });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].mmsi, '368889000');
  assert.equal(records[0].imo, '8812162');
  assert.equal(records[0].hasImo, true);
  assert.equal(
    records[0].equasisUrl,
    'https://www.equasis.org/EquasisWeb/public/HomePage',
  );
  assert.equal(
    records[0].maritimeDatabaseUrl,
    'https://maritime-database.com/',
  );
  h.layer.destroy(h.viewer);
});

test('a failing background source marks the error and returns false', async () => {
  const h = harness();
  h.layer.destroy(h.viewer);
  const broken = createVesselInfoLayer({
    source: {
      getBackgrounds: () => {
        throw new Error('backgrounds failed');
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
  assert.match(broken.getStats().error, /backgrounds failed/);
  broken.destroy(h.viewer);
});
