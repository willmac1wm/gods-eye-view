import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrafficCamerasLayer } from './index.js';

function harness(source) {
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
  const layer = createTrafficCamerasLayer({
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
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources, events, visible, cleared };
}

const snapshot = {
  fetchedAt: 1,
  stale: false,
  nj511Configured: false,
  nj511Error: null,
  deldotError: null,
  records: [
    {
      id: 'DRBA:38.93360,-74.96080',
      name: 'Cape May Ferry Terminal',
      imageUrl: 'https://example.invalid/ferry.jpg',
      playerUrl: null,
      streamUrl: null,
      road: 'Ferry Terminal',
      lat: 38.9336,
      lng: -74.9608,
      heading: null,
      fov: 60,
      headingConfidence: 'high',
      source: 'DRBA',
    },
    {
      id: 'DelDOT TMC:abc',
      name: 'US 9 @ Lewes Ferry Terminal',
      imageUrl: 'https://tmc.deldot.gov/video/abc.m3u8',
      playerUrl: null,
      streamUrl: null,
      road: 'US 9',
      lat: 38.9558,
      lng: -75.1436,
      heading: 180,
      fov: 60,
      headingConfidence: 'high',
      source: 'DelDOT TMC',
    },
  ],
  nj511Count: 0,
  deldotCount: 2,
};

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve(snapshot);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('update pins the DelDOT cameras and reports NJ511 unconfigured', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().nj511Configured, false);
  assert.equal(h.layer.getStats().deldotCount, 2);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'traffic-cameras');
  assert.equal(h.events[0][1].length, 2);
  assert.match(h.events[0][1][0].title, /Ferry Terminal/);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['traffic-cameras']);
  assert.deepEqual(h.visible.at(-1), ['traffic-cameras', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per camera', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  const ferry = records.find((record) => record.source === 'DRBA');
  assert.equal(ferry.road, 'Ferry Terminal');
  assert.equal(ferry.hasImage, true);
  h.layer.destroy(h.viewer);
});
