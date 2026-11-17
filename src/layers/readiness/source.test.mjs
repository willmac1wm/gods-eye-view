import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadinessSource } from './source.js';

function layerWith(records, stats = { lastUpdate: 1 }) {
  return {
    getAnalystRecords: () => records,
    getStats: () => stats,
  };
}

const floodLayers = () => ({
  nwsAlertCard: layerWith([
    { event: 'Coastal Flood Advisory', severity: 'Moderate' },
  ]),
  tides: layerWith([{ observedFtMllw: 3.0, floodStage: 'none' }]),
  outages: layerWith([{ customersOut: 0 }]),
  drought: layerWith([{ category: 0 }]),
  spaceWeather: layerWith([{ kp: 2 }]),
});

test('getSnapshot computes the drivers from the layer records', async () => {
  const source = createReadinessSource({ readLayers: floodLayers });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.drivers.flood.active, true);
  assert.equal(snapshot.drivers.storm.active, false);
  assert.equal(snapshot.drivers.power.active, false);
  assert.deepEqual(snapshot.unavailable, []);
});

test('getSnapshot marks a missing driver layer unavailable, never due', async () => {
  const source = createReadinessSource({
    readLayers: () => ({
      nwsAlertCard: null,
      tides: layerWith([]),
      outages: layerWith([]),
      drought: layerWith([]),
      spaceWeather: layerWith([]),
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.drivers.flood.active, false);
  assert.deepEqual(snapshot.unavailable, ['nws']);
});

test('getSnapshot treats a throwing layer as missing, never a crash', async () => {
  const source = createReadinessSource({
    readLayers: () => ({
      nwsAlertCard: {
        getAnalystRecords: () => {
          throw new Error('boom');
        },
        getStats: () => {
          throw new Error('boom');
        },
      },
      tides: layerWith([]),
      outages: layerWith([]),
      drought: layerWith([]),
      spaceWeather: layerWith([]),
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.drivers.flood.active, false);
  assert.deepEqual(snapshot.unavailable, ['nws']);
});

test('getSnapshot honors an aborted signal', async () => {
  const source = createReadinessSource({ readLayers: floodLayers });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => source.getSnapshot({ signal: controller.signal }),
    /aborted/i,
  );
});
