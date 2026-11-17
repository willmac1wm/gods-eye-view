import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlprAvoidanceLayer } from './index.js';

function snapshot(overrides = {}) {
  return {
    available: true,
    reason: null,
    a: { lat: 39.0, lon: -74.6 },
    b: { lat: 39.1, lon: -74.5 },
    routes: [
      {
        distanceM: 8500,
        durationS: 900,
        geometry: [
          [-74.6, 39.0],
          [-74.55, 39.0],
          [-74.5, 39.0],
        ],
        cameraCount: 1,
        cameraIds: ['alpr:1'],
        onRoute: [{ id: 'alpr:1', lat: 39.0, lon: -74.55, distanceM: 0 }],
      },
      {
        distanceM: 9200,
        durationS: 1200,
        geometry: [
          [-74.6, 39.1],
          [-74.55, 39.1],
          [-74.5, 39.1],
        ],
        cameraCount: 0,
        cameraIds: [],
        onRoute: [],
      },
    ],
    fastestIndex: 0,
    lowestIndex: 1,
    sameRoute: false,
    camerasConsidered: 1,
    alprAvailable: true,
    alprStale: false,
    alprSaturated: false,
    fetchedAt: 1,
    ...overrides,
  };
}

function harness({ source } = {}) {
  const calls = [];
  const fakeSource = source ?? {
    async getSnapshot({ force } = {}) {
      calls.push(force === true ? 'force' : 'tick');
      return snapshot();
    },
  };
  const entries = [];
  const overlayHost = {
    setEntries(id, list, options) {
      entries.push({ id, list, options });
    },
    setVisible(id, visible) {
      overlayHost.visible[id] = visible;
    },
    clearSource(id) {
      overlayHost.cleared ??= [];
      overlayHost.cleared.push(id);
    },
    visible: {},
    cleared: [],
  };
  const rendering = {
    shown: [],
    hidden: 0,
    scenes: [],
    show(options) {
      rendering.shown.push(options);
      return { shown: true, entities: 3 };
    },
    hide() {
      rendering.hidden += 1;
    },
    setScene(scene) {
      rendering.scenes.push(scene);
    },
    getState: () => ({ entities: rendering.shown.length, hasViewer: true }),
    destroy: () => {
      rendering.destroyed = true;
    },
    destroyed: false,
  };
  const layer = createAlprAvoidanceLayer({
    source: fakeSource,
    overlayHost,
    rendering,
    now: () => Date.parse('2026-11-17T14:00:00.000Z'),
  });
  return { layer, overlayHost, rendering, entries, calls, fakeSource };
}

test('enable scores the routes, labels them and draws both', async () => {
  const { layer, overlayHost, rendering } = harness();
  layer.init({});
  layer.enable({});
  const updated = await layer.update({});
  assert.equal(updated, true);
  assert.equal(overlayHost.visible['alpr-avoidance-routing'], true);
  assert.equal(rendering.shown.length, 1);
  assert.equal(rendering.shown[0].sameRoute, false);
  const stats = layer.getStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.fastestIndex, 0);
  assert.equal(stats.lowestIndex, 1);
  assert.equal(stats.camerasConsidered, 1);
  assert.equal(stats.alprAvailable, true);
  assert.equal(layer.getAnalystRecords().length, 2);
  assert.equal(layer.getAnalystRecords()[0].kind, 'fastest');
});

test('the row controls list fastest and lowest with the privacy note', async () => {
  const { layer } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  const controls = layer.getRowControls();
  assert.match(controls.info, /Fastest: 15 min · 1 known cameras/);
  assert.match(controls.info, /Lowest exposure: 20 min · 0 known cameras/);
  assert.match(controls.infoTitle, /no plate reads, no live feeds, no facial recognition/);
  assert.equal(controls.list.items.length, 2);
  assert.equal(controls.list.items[0].id, 'fastest');
  assert.equal(controls.list.items[1].id, 'lowest');
  assert.match(controls.list.items[1].text, /\+5 min/);
  const refreshChip = controls.chips.find((chip) => chip.id === 'refresh');
  assert.equal(refreshChip.disabled, false);
});

test('the refresh chip forces a new fetch; an unknown param is refused', async () => {
  const { layer, calls } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  assert.deepEqual(calls, ['tick']);
  assert.equal(layer.setParams({ refresh: true }), true);
  await layer.update({});
  assert.deepEqual(calls, ['tick', 'force']);
  assert.equal(layer.setParams({ refresh: true }), true);
  assert.equal(layer.setParams({ nope: true }), false);
});

test('no endpoints shows the placement guidance and draws nothing', async () => {
  const { layer, rendering } = harness({
    source: {
      async getSnapshot() {
        return {
          available: false,
          reason: 'no-endpoints',
          routes: [],
          fastestIndex: -1,
          lowestIndex: -1,
          camerasConsidered: 0,
          alprAvailable: false,
          alprStale: false,
          alprSaturated: false,
          fetchedAt: 1,
        };
      },
    },
  });
  layer.init({});
  layer.enable({});
  await layer.update({});
  const controls = layer.getRowControls();
  assert.match(controls.info, /Place A and B in the Directions layer/);
  assert.equal(controls.list.items.length, 0);
  assert.equal(controls.chips[0].disabled, true);
  assert.equal(rendering.shown.length, 0);
  assert.equal(layer.getStats().count, 0);
});

test('a source failure keeps the layer alive and records the error', async () => {
  const { layer } = harness({
    source: {
      async getSnapshot() {
        throw new Error('Routing unavailable (HTTP 503)');
      },
    },
  });
  layer.init({});
  layer.enable({});
  const updated = await layer.update({});
  assert.equal(updated, false);
  assert.match(layer.getStats().error, /Routing unavailable/);
});

test('disable hides the routes and clears the label; destroy tears down', async () => {
  const { layer, overlayHost, rendering } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  layer.disable({});
  assert.equal(rendering.hidden, 1);
  assert.ok(overlayHost.cleared.includes('alpr-avoidance-routing'));
  assert.equal(overlayHost.visible['alpr-avoidance-routing'], false);
  layer.destroy({});
  assert.equal(rendering.destroyed, true);
});
