// src/layers/ports/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortsLayer } from './index.js';
import { createPortsSource } from './source.js';

const TINY = {
  version: 1,
  generatedAt: '2026-11-17',
  ports: [
    {
      id: 'philadelphia',
      name: 'Philadelphia',
      state: 'PA',
      lat: 39.95,
      lon: -75.1333,
      channelDepthM: 13.7,
    },
    {
      id: 'cape-may',
      name: 'Cape May',
      state: 'NJ',
      lat: 38.95,
      lon: -74.905,
      depthClass: 'shallow',
    },
  ],
  chokepoints: [
    {
      id: 'dover',
      name: 'Strait of Dover',
      lat: 51,
      lon: 1.5,
      connects: 'English Channel – North Sea',
    },
  ],
};

function harness({ snapshot = TINY } = {}) {
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
  const layer = createPortsLayer({
    source: createPortsSource({ snapshot }),
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

test('update publishes one label per port and per chokepoint', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'ports');
  assert.equal(h.events[0][1].length, 3);
  assert.match(h.events[0][1][0].title, /Philadelphia/);
  assert.match(h.events[0][1][0].subtitle, /Port · PA · channel 13\.7 m/);
  assert.match(h.events[0][1][1].subtitle, /Port · NJ · shallow water/);
  assert.match(h.events[0][1][2].title, /Strait of Dover/);
  assert.match(h.events[0][1][2].subtitle, /Chokepoint/);
  assert.equal(h.layer.getStats().count, 3);
  assert.equal(h.layer.getStats().ports, 2);
  assert.equal(h.layer.getStats().chokepoints, 1);
  h.layer.destroy(h.viewer);
});

test('an empty snapshot reports unavailable, never an empty map', async () => {
  const h = harness({
    snapshot: { version: 1, ports: [], chokepoints: [] },
  });
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.events.length, 0);
  assert.match(h.layer.getStats().error, /Ports unavailable/);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['ports']);
  assert.deepEqual(h.visible.at(-1), ['ports', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry ports then chokepoints', async () => {
  const h = harness();
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 3);
  assert.equal(records[0].kind, 'port');
  assert.equal(records[0].name, 'Philadelphia');
  assert.equal(records[0].channelDepthM, 13.7);
  assert.equal(records[2].kind, 'chokepoint');
  assert.equal(records[2].name, 'Strait of Dover');
  h.layer.destroy(h.viewer);
});

test('a failing snapshot source marks the error and returns false', async () => {
  const h = harness();
  h.layer.destroy(h.viewer);
  const broken = createPortsLayer({
    source: {
      getSnapshot: () => {
        throw new Error('snapshot failed');
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
  assert.match(broken.getStats().error, /snapshot failed/);
  broken.destroy(h.viewer);
});
