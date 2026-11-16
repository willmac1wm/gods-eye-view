import assert from 'node:assert/strict';
import test from 'node:test';
import { createGaugesLayer } from './index.js';

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
  const layer = createGaugesLayer({
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
  gauges: [
    {
      siteId: '01411300',
      name: 'Tuckahoe River at Head of River, NJ',
      shortName: 'Tuckahoe R. — Head of River',
      lat: 39.3069,
      lon: -74.8206,
      discharge: {
        value: 17.4,
        unit: 'ft3/s',
        time: '2026-11-16T16:05:00+00:00',
        timeMs: Date.parse('2026-11-16T16:05:00+00:00'),
        approvalStatus: 'Provisional',
      },
      gageHeight: {
        value: 3.94,
        unit: 'ft',
        time: '2026-11-16T16:20:00+00:00',
        timeMs: Date.parse('2026-11-16T16:20:00+00:00'),
        approvalStatus: 'Provisional',
      },
      asOfMs: Date.parse('2026-11-16T16:20:00+00:00'),
      stale: false,
    },
  ],
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

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => snapshot });
  const b = harness({ getSnapshot: async () => ({ gauges: [] }) });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 1);
  assert.equal(b.layer.getStats().count, 0);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0][0], 'water-gauges');
  assert.equal(a.events[0][1].length, 1);
  assert.equal(
    a.events[0][1][0].title,
    'Tuckahoe R. — Head of River 3.94′',
  );
  assert.match(a.events[0][1][0].subtitle, /17.4 ft³\/s/);
  assert.match(a.events[0][1][0].subtitle, /gage datum/);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['water-gauges']);
  assert.deepEqual(h.visible.at(-1), ['water-gauges', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records round-trip through the entities', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const [record] = h.layer.getAnalystRecords();
  assert.equal(record.id, '01411300');
  assert.equal(record.site, 'Tuckahoe River at Head of River, NJ');
  assert.equal(record.gageHeightFt, 3.94);
  assert.equal(record.dischargeCfs, 17.4);
  assert.equal(record.gageDatum, true);
  assert.equal(record.provisional, true);
  assert.equal(record.stale, false);
  assert.equal(record.time, '2026-11-16T16:20:00+00:00');
  assert.ok(Math.abs(record.lat - 39.3069) < 1e-6);
  assert.ok(Math.abs(record.lon - -74.8206) < 1e-6);
  h.layer.destroy(h.viewer);
});
