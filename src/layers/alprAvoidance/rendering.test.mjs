import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlprAvoidanceRendering } from './rendering.js';

// A Cesium stand-in: the rendering only needs Cartesian3, Color,
// PolylineDashMaterialProperty, ClassificationType and HeightReference.
function fakeCesium() {
  class PolylineDashMaterialProperty {
    constructor(options) {
      this.options = options;
    }
  }
  return {
    Cartesian3: {
      fromDegrees: (lon, lat) => ({ lon, lat }),
      fromDegreesArray: (flat) => ({ flat }),
    },
    Color: {
      fromCssColorString: (css) => ({ css }),
      BLACK: 'black',
    },
    PolylineDashMaterialProperty,
    ClassificationType: { BOTH: 'both' },
    HeightReference: { CLAMP_TO_GROUND: 'clamp' },
  };
}

function fakeViewer() {
  const entities = [];
  return {
    entities: {
      values: entities,
      add(entity) {
        entities.push(entity);
        return entity;
      },
      remove(entity) {
        const index = entities.indexOf(entity);
        if (index >= 0) entities.splice(index, 1);
      },
    },
  };
}

const FASTEST = {
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
};

const LOWEST = {
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
};

test('show draws the fastest solid and the lowest dashed, with camera dots', () => {
  const cesium = fakeCesium();
  const viewer = fakeViewer();
  const rendering = createAlprAvoidanceRendering({ cesium });
  rendering.setScene({ viewer });
  const result = rendering.show({ fastest: FASTEST, lowest: LOWEST, sameRoute: false });
  assert.equal(result.shown, true);
  const ids = viewer.entities.values.map((entity) => entity.id);
  assert.ok(ids.includes('alpr-avoidance:route:fastest'));
  assert.ok(ids.includes('alpr-avoidance:route:lowest'));
  assert.ok(ids.includes('alpr-avoidance:camera:fastest:alpr:1'));
  // The fastest line is a solid color; the lowest is a dash material.
  const fastest = viewer.entities.values.find(
    (entity) => entity.id === 'alpr-avoidance:route:fastest',
  );
  const lowest = viewer.entities.values.find(
    (entity) => entity.id === 'alpr-avoidance:route:lowest',
  );
  assert.equal(fastest.polyline.material.css, '#7aa5ff');
  assert.ok(
    lowest.polyline.material instanceof cesium.PolylineDashMaterialProperty,
  );
  assert.equal(lowest.polyline.material.options.color.css, '#9fd6a4');
  assert.equal(rendering.getState().entities, 3);
});

test('show with the same route draws one line and hides the second', () => {
  const viewer = fakeViewer();
  const rendering = createAlprAvoidanceRendering({ cesium: fakeCesium() });
  rendering.setScene({ viewer });
  rendering.show({ fastest: FASTEST, lowest: FASTEST, sameRoute: true });
  const ids = viewer.entities.values.map((entity) => entity.id);
  assert.ok(ids.includes('alpr-avoidance:route:fastest'));
  assert.ok(!ids.includes('alpr-avoidance:route:lowest'));
});

test('hide removes every owned entity and a second show replaces the first', () => {
  const viewer = fakeViewer();
  const rendering = createAlprAvoidanceRendering({ cesium: fakeCesium() });
  rendering.setScene({ viewer });
  rendering.show({ fastest: FASTEST, lowest: LOWEST, sameRoute: false });
  assert.equal(viewer.entities.values.length, 3);
  rendering.hide();
  assert.equal(viewer.entities.values.length, 0);
  rendering.show({ fastest: FASTEST, lowest: null, sameRoute: true });
  assert.equal(viewer.entities.values.length, 2);
  rendering.destroy();
  assert.equal(viewer.entities.values.length, 0);
  assert.equal(rendering.getState().hasViewer, false);
});

test('show without a viewer reports no-viewer and draws nothing', () => {
  const rendering = createAlprAvoidanceRendering({ cesium: fakeCesium() });
  assert.deepEqual(
    rendering.show({ fastest: FASTEST, lowest: LOWEST, sameRoute: false }),
    { shown: false, reason: 'no-viewer' },
  );
});
