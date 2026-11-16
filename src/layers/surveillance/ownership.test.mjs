import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createSurveillanceLayer } from './index.js';

const COUNTY_BOX = { south: 38.9, west: -75.15, north: 39.35, east: -74.55 };

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
    camera: {
      computeViewRectangle() {
        return Cesium.Rectangle.fromDegrees(
          COUNTY_BOX.west,
          COUNTY_BOX.south,
          COUNTY_BOX.east,
          COUNTY_BOX.north,
        );
      },
      moveEnd: {
        addEventListener() {
          return () => {};
        },
      },
    },
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
  };
  const layer = createSurveillanceLayer({
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
  records: [
    {
      id: 'surv:13116656753',
      osmId: 13116656753,
      latitude: 38.9326358,
      longitude: -74.9230437,
      operator: null,
      manufacturer: null,
      cameraType: null,
      zone: null,
      directionDeg: null,
      ref: null,
      lastVerified: null,
      source: null,
    },
    {
      id: 'surv:14077264754',
      osmId: 14077264754,
      latitude: 39.0346601,
      longitude: -74.7705174,
      operator: null,
      manufacturer: null,
      cameraType: 'fixed',
      zone: 'parking',
      directionDeg: 300,
      ref: null,
      lastVerified: null,
      source: null,
    },
  ],
  stale: false,
  saturated: false,
  coverage: { ...COUNTY_BOX },
};

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness({
      fetch(box, options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    resolve({ ...snapshot, records: [] });
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(signal.aborted, true);
  }
});

test('a fresh update renders both county cameras and reuses the box', async () => {
  let calls = 0;
  const h = harness({
    async fetch() {
      calls++;
      return structuredClone(snapshot);
    },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().error, null);
  assert.equal(calls, 1);
  // Same view within the 24-hour reuse window: no second Overpass call.
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(calls, 1);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'surveillance-cameras');
  assert.equal(h.events[0][1].length, 2);
});

test('a failed fetch reports the error and the next tick retries', async () => {
  let calls = 0;
  const h = harness({
    async fetch() {
      calls++;
      throw new Error('Overpass temporarily unavailable');
    },
  });
  assert.equal(await h.layer.update(h.viewer), false);
  assert.match(h.layer.getStats().error, /Overpass temporarily unavailable/);
  assert.equal(h.layer.getStats().count, 0);
  // The failure is not reused: the next update retries instead of waiting.
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(calls, 2);
});

test('a view wider than three degrees keeps pins and asks to zoom in', async () => {
  let calls = 0;
  const h = harness({
    async fetch() {
      calls++;
      return structuredClone(snapshot);
    },
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(calls, 1);
  h.viewer.camera.computeViewRectangle = () =>
    Cesium.Rectangle.fromDegrees(-77, 37, -73, 41);
  // Too wide: no fetch, no failure, pins stay on screen.
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(calls, 1);
  assert.equal(h.layer.getStats().error, null);
  assert.equal(h.layer.getStats().zoomIn, true);
  assert.equal(h.layer.getStats().count, 2);
});
