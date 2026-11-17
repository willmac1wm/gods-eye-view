// src/layers/plume/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFalloutPlumeLayer } from './index.js';
import { createFalloutPlumeSource } from './source.js';

// Verbatim live NWS hourly periods from 2026-11-17 (PHI/40,55).
const payload = {
  properties: {
    periods: [
      {
        startTime: '2026-11-17T07:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
      {
        startTime: '2026-11-17T08:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
      {
        startTime: '2026-11-17T09:00:00-05:00',
        windSpeed: '5 mph',
        windDirection: 'NW',
      },
    ],
  },
};

function harness({ source } = {}) {
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
  const layer = createFalloutPlumeLayer({
    source:
      source ??
      createFalloutPlumeSource({
        fetchImpl: async () =>
          new Response(JSON.stringify(payload), { status: 200 }),
      }),
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

test('update draws the plume geometry and publishes the anchor label', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0][0], 'fallout-plume');
  assert.equal(h.published[0][1].length, 1);
  assert.match(h.published[0][1][0].title, /SE/);
  assert.match(h.published[0][1][0].details[1], /not a HYSPLIT run/);
  // The renderer owns one data source with the six plume entities.
  assert.equal(h.sources.length, 1);
  assert.equal(h.sources[0].entities.values.length, 6);
  assert.equal(h.layer.getStats().count, 7);
  assert.equal(h.layer.getStats().stale, false);
  assert.equal(h.layer.getAnalystRecords().length, 7);
  assert.deepEqual(
    h.layer.getAnalystRecords().map((row) => row.kind),
    ['wind', 'wind', 'wind', 'node', 'node', 'node', 'node'],
  );
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the layer usable and records the error', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  const failing = createFalloutPlumeLayer({
    source: {
      getSnapshot: () => {
        throw new Error('Fallout plume HTTP 502');
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
  assert.match(failing.getStats().error, /Fallout plume HTTP 502/);
  failing.destroy(h.viewer);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay and geometry', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.cleared[0][0], 'fallout-plume');
  assert.equal(h.sources.length, 0);
});
