import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_IMAGERY_HOST } from '../../maps/imageryHost.js';
import { createSatelliteDrape } from './rendering.js';

class FakeTilingScheme {}
class FakeProvider {
  constructor(options) {
    Object.assign(this, options);
  }
}
class FakeImageryLayer {
  constructor(provider) {
    this.provider = provider;
    this.alpha = 1;
    this.destroyed = false;
  }
  destroy() {
    this.destroyed = true;
  }
}

function fakeCollection() {
  const layers = [];
  return {
    layers,
    add(layer) {
      layers.push(layer);
    },
    remove(layer, destroy) {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      if (destroy) layer.destroy();
    },
    contains(layer) {
      return layers.includes(layer);
    },
  };
}

function fakeCesium() {
  return {
    Rectangle: {
      fromDegrees: (west, south, east, north) => ({
        west,
        south,
        east,
        north,
      }),
    },
    WebMercatorTilingScheme: FakeTilingScheme,
    UrlTemplateImageryProvider: FakeProvider,
    ImageryLayer: FakeImageryLayer,
  };
}

const TEMPLATE =
  'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-16/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';

test('show drapes the county rectangle and hide removes it', () => {
  const collection = fakeCollection();
  const drape = createSatelliteDrape({
    host: () => ({ collection, kind: 'globe' }),
    cesium: fakeCesium(),
  });
  drape.setScene({ viewer: {} });
  const shown = drape.show('a', { template: TEMPLATE, credit: 'NASA GIBS' });
  assert.equal(shown.shown, true);
  assert.equal(shown.kind, 'globe');
  assert.equal(collection.layers.length, 1);
  const layer = collection.layers[0];
  assert.equal(layer.provider.url, TEMPLATE);
  assert.deepEqual(layer.provider.rectangle, {
    west: -75.15,
    south: 38.9,
    east: -74.55,
    north: 39.35,
  });
  assert.equal(layer.alpha, 1);
  const state = drape.getState();
  assert.equal(state.slots.length, 1);
  assert.equal(state.slots[0].template, TEMPLATE);
  drape.hide('a');
  assert.equal(collection.layers.length, 0);
  assert.equal(layer.destroyed, true);
});

test('a second show on the same slot replaces, never duplicates', () => {
  const collection = fakeCollection();
  const drape = createSatelliteDrape({
    host: () => ({ collection, kind: 'globe' }),
    cesium: fakeCesium(),
  });
  drape.setScene({ viewer: {} });
  drape.show('a', { template: TEMPLATE, credit: 'NASA GIBS' });
  const first = collection.layers[0];
  drape.show('a', {
    template: TEMPLATE.replace('2026-11-16', '2026-11-15'),
    credit: 'NASA GIBS',
  });
  assert.equal(collection.layers.length, 1);
  assert.equal(first.destroyed, true);
  assert.ok(collection.layers[0].provider.url.includes('2026-11-15'));
});

test('two slots (A + B) coexist; alpha clamps and sets', () => {
  const collection = fakeCollection();
  const drape = createSatelliteDrape({
    host: () => ({ collection, kind: 'globe' }),
    cesium: fakeCesium(),
  });
  drape.setScene({ viewer: {} });
  drape.show('a', { template: TEMPLATE, credit: 'NASA GIBS', alpha: 1 });
  drape.show('b', {
    template: TEMPLATE.replace('2026-11-16', '2026-11-09'),
    credit: 'NASA GIBS',
    alpha: 0.5,
  });
  assert.equal(collection.layers.length, 2);
  assert.equal(collection.layers[1].alpha, 0.5);
  assert.equal(drape.setAlpha('b', 2), true);
  assert.equal(collection.layers[1].alpha, 1);
  assert.equal(drape.setAlpha('b', -1), true);
  assert.equal(collection.layers[1].alpha, 0);
  assert.equal(drape.setAlpha('missing', 0.5), false);
});

test('no imagery host means show reports it and nothing is added', () => {
  const collection = fakeCollection();
  const drape = createSatelliteDrape({
    host: () => ({ collection: null, kind: 'none' }),
    cesium: fakeCesium(),
  });
  drape.setScene({ viewer: {} });
  const shown = drape.show('a', { template: TEMPLATE, credit: 'NASA GIBS' });
  assert.equal(shown.shown, false);
  assert.equal(shown.reason, NO_IMAGERY_HOST);
  assert.equal(collection.layers.length, 0);
});

test('a host switch re-homes the visible drape on the new collection', () => {
  const globe = fakeCollection();
  const tileset = fakeCollection();
  let current = globe;
  const drape = createSatelliteDrape({
    host: () => ({
      collection: current,
      kind: current === globe ? 'globe' : 'tileset',
    }),
    cesium: fakeCesium(),
  });
  drape.setScene({ viewer: {} });
  drape.show('a', { template: TEMPLATE, credit: 'NASA GIBS' });
  assert.equal(globe.layers.length, 1);
  current = tileset;
  drape.setScene({ viewer: {}, tileset: {} });
  assert.equal(globe.layers.length, 0);
  assert.equal(tileset.layers.length, 1);
  assert.equal(drape.getState().kind, 'tileset');
  drape.destroy();
  assert.equal(tileset.layers.length, 0);
});
