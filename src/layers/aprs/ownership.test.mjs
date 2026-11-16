import assert from 'node:assert/strict';
import test from 'node:test';
import { createAprsLayer } from './index.js';
import { AprsKeyMissingError } from './source.js';

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
  const layer = createAprsLayer({
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

const row = {
  callsign: 'KC2DUX',
  place: 'Eldora, Dennis Twp',
  lon: -74.82067,
  lat: 39.19117,
  timeMs: Date.now() - 60_000,
  tempC: 3,
  tempF: 37.4,
  humidity: 75,
  pressureMb: 1025.2,
  pressureInHg: 30.27,
  windDirDeg: 24,
  windSpeedMps: 0,
  windSpeedMph: 0,
  windGustMps: 1.8,
  windGustMph: 4,
  rain1hMm: 0,
  rain24hMm: 0,
  rainMnMm: 0,
  luminosity: null,
  ageMin: 1,
  stale: false,
  missing: false,
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
    resolve([row]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => [row] });
  const b = harness({ getSnapshot: async () => [] });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 1);
  assert.equal(b.layer.getStats().count, 0);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'aprs-weather');
  assert.equal(a.events[0][1].length, 1);
  assert.equal(a.events[0][1][0].title, 'KC2DUX 37°F');
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => [row] });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['aprs-weather']);
  assert.deepEqual(h.visible.at(-1), ['aprs-weather', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => [row] });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, 'KC2DUX');
  assert.equal(record.place, 'Eldora, Dennis Twp');
  assert.equal(record.tempF, 37.4);
  assert.equal(record.humidity, 75);
  assert.equal(record.pressureInHg, 30.27);
  assert.equal(record.windSpeedMph, 0);
  assert.equal(record.stale, false);
  assert.equal(record.missing, false);
  assert.ok(Math.abs(record.lat - 39.19117) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.82067) < 1e-6);
  h.layer.destroy(h.viewer);
});

test('key-missing source failure leaves the layer empty with its own error', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new AprsKeyMissingError();
    },
  });
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.layer.getStats().error, 'APRS key not configured');
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('stale rows still render, dimmed, and count as not fresh', async () => {
  const h = harness({
    getSnapshot: async () => [{ ...row, stale: true, ageMin: 90 }],
  });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getStats().freshCount, 0);
  assert.equal(h.events[0][1][0].subtitle, 'STALE — last report 90 min ago');
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.stale, true);
  h.layer.destroy(h.viewer);
});
