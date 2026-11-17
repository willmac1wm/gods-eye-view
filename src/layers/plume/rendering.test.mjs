// src/layers/plume/rendering.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlumeSnapshot } from './records.js';
import { createPlumeRendering } from './rendering.js';

const WINDS = [0, 1, 2].map((i) => ({
  time: `2026-11-17T0${7 + i}:00:00-05:00`,
  timeIso: null,
  speedMph: 5,
  directionFrom: 315,
}));

function snapshot() {
  return buildPlumeSnapshot({ fetchedAt: 1_793_123_456_789, winds: WINDS });
}

function harness() {
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
  const rendering = createPlumeRendering({ viewer });
  return { rendering, viewer, sources };
}

test('setSnapshot draws release, path, cone, and EPZ entities', () => {
  const h = harness();
  assert.equal(h.rendering.setSnapshot(snapshot()), true);
  assert.equal(h.sources.length, 1);
  const entities = h.sources[0].entities.values;
  const ids = entities.map((entity) => entity.id).sort();
  assert.deepEqual(ids, [
    'plume:cone',
    'plume:cone:outline',
    'plume:epz',
    'plume:epz:outline',
    'plume:path',
    'plume:release',
  ]);
  const path = entities.find((entity) => entity.id === 'plume:path');
  assert.equal(path.polyline.positions.getValue().length, 4);
  const cone = entities.find((entity) => entity.id === 'plume:cone');
  assert.equal(cone.polygon.hierarchy.getValue().positions.length, 7);
  h.rendering.destroy();
});

test('a second snapshot swaps the data source instead of stacking', () => {
  const h = harness();
  assert.equal(h.rendering.setSnapshot(snapshot()), true);
  const first = h.sources[0];
  assert.equal(h.rendering.setSnapshot(snapshot()), true);
  assert.equal(h.sources.length, 1);
  assert.notEqual(h.sources[0], first);
  h.rendering.setVisible(false);
  assert.equal(h.sources[0].show, false);
  h.rendering.setVisible(true);
  assert.equal(h.sources[0].show, true);
  h.rendering.clear();
  assert.equal(h.sources.length, 0);
  h.rendering.destroy();
});

test('a one-node snapshot draws only the release and the EPZ', () => {
  const h = harness();
  const still = buildPlumeSnapshot({ fetchedAt: 1_793_123_456_789, winds: [] });
  assert.equal(h.rendering.setSnapshot(still), true);
  const ids = h.sources[0].entities.values
    .map((entity) => entity.id)
    .sort();
  assert.deepEqual(ids, ['plume:epz', 'plume:epz:outline', 'plume:release']);
  h.rendering.destroy();
});

test('destroy drops the geometry and refuses further snapshots', () => {
  const h = harness();
  assert.equal(h.rendering.setSnapshot(snapshot()), true);
  h.rendering.destroy();
  assert.equal(h.sources.length, 0);
  assert.equal(h.rendering.setSnapshot(snapshot()), false);
  assert.throws(
    () => createPlumeRendering({ viewer: null }),
    /requires a viewer/,
  );
});
