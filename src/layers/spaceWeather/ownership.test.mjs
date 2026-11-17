import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpaceWeatherLayer } from './index.js';

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
  const layer = createSpaceWeatherLayer({
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
  kp: {
    timeTag: '2026-11-16T22:27:00',
    kp: 0,
    kpIndex: 0,
    gScale: null,
    activity: 'quiet',
  },
  forecast: {
    maxKp: 4.67,
    maxKpTime: '2026-11-18T00:00:00',
    maxScale: 'G1',
    entries: [],
  },
  threeDay: {
    greatestExpectedKp: 4.67,
    greatestExpectedScale: 'G1',
    greatestObservedKp: 1,
    issued: '2026 Nov 16 1230 UTC',
  },
  solarWind: { timeTag: '2026-11-16T22:01:00', speed: 418, density: 5.4, temperature: 118000 },
  mag: { timeTag: '2026-11-16T22:01:00', bt: 6.5, bzGsm: -2.4 },
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

test('update publishes one quiet-Kp label with the G1 forecast line', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'space-weather');
  assert.match(h.events[0][1][0].title, /Kp 0 · quiet/);
  assert.match(h.events[0][1][0].subtitle, /Max expected Kp 4.67/);
  assert.match(h.events[0][1][0].subtitle, /No aurora this far south/);
  const stats = h.layer.getStats();
  assert.equal(stats.kp, 0);
  assert.equal(stats.forecastMaxKp, 4.67);
  assert.equal(stats.solarWindSpeed, 418);
  assert.equal(stats.bzGsm, -2.4);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['space-weather']);
  assert.deepEqual(h.visible.at(-1), ['space-weather', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry the current Kp reading', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].kp, 0);
  assert.equal(records[0].activity, 'quiet');
  assert.equal(records[0].forecastMaxKp, 4.67);
  h.layer.destroy(h.viewer);
});
