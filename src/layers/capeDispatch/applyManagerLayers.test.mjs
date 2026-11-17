import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCapeManagerLayers,
  fetchAndApplyCapeManagerLayers,
} from './applyManagerLayers.js';

function fakeManager(ids = ['cape-cad', 'cape-flood', 'flights']) {
  const enabled = new Map(ids.map((id) => [id, false]));
  return {
    layers: new Map(ids.map((id) => [id, {}])),
    enabled,
    setEnabled(id, on) {
      if (!enabled.has(id)) throw new Error(`unknown ${id}`);
      enabled.set(id, on);
    },
  };
}

test('applyCapeManagerLayers toggles only cape-* ids', () => {
  const dm = fakeManager();
  const applied = applyCapeManagerLayers({
    dataManager: dm,
    layers: {
      'cape-cad': true,
      'cape-flood': false,
      flights: true,
      'other-layer': true,
    },
  });
  assert.deepEqual(applied.sort(), ['cape-cad', 'cape-flood']);
  assert.equal(dm.enabled.get('cape-cad'), true);
  assert.equal(dm.enabled.get('cape-flood'), false);
  assert.equal(dm.enabled.get('flights'), false);
});

test('shareOwnsLayers skips manager prefs', () => {
  const dm = fakeManager();
  const applied = applyCapeManagerLayers({
    dataManager: dm,
    layers: { 'cape-cad': true },
    shareOwnsLayers: true,
  });
  assert.deepEqual(applied, []);
  assert.equal(dm.enabled.get('cape-cad'), false);
});

test('fetchAndApplyCapeManagerLayers reads config endpoint', async () => {
  const dm = fakeManager(['cape-cad', 'cape-whales']);
  const applied = await fetchAndApplyCapeManagerLayers({
    dataManager: dm,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          config: { globe: { layers: { 'cape-cad': true, 'cape-whales': true } } },
        }),
        { status: 200 },
      ),
  });
  assert.deepEqual(applied.sort(), ['cape-cad', 'cape-whales']);
  assert.equal(dm.enabled.get('cape-cad'), true);
});
