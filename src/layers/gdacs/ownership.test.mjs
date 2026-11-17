// src/layers/gdacs/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGdacsLayer } from './index.js';
import { normalizeGdacsEvent } from './records.js';

function harness({ events = [] } = {}) {
  const published = [];
  const visible = [];
  const cleared = [];
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
  const layer = createGdacsLayer({
    source: {
      getSnapshot: async () => ({
        fetchedAt: 1_793_123_456_789,
        stale: false,
        ttlMs: 900_000,
        count: events.length,
        events,
      }),
    },
    overlayHost: {
      setEntries(...args) {
        published.push(args);
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
  return { layer, viewer, published, visible, cleared, sources };
}

const QUAKE = normalizeGdacsEvent({
  title: 'Green earthquake (Magnitude 6.6M, Depth:68km) in Indonesia',
  link: 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
  pubDate: 'Mon, 16 Nov 2026 21:26:52 GMT',
  fromDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  toDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  eventType: 'EQ',
  alertLevel: 'Green',
  eventId: '1577696',
  country: 'Indonesia',
  iso3: 'IDN',
  lat: '-6.0804',
  lon: '131.4868',
  severity: { text: 'Magnitude 6.6M, Depth:68km', unit: 'M', value: '6.6' },
  population: { text: '6 thousand in MMI V', unit: 'in MMI V', value: '6100' },
});

test('update publishes one label per positioned GDACS event', async () => {
  const h = harness({ events: [QUAKE] });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0][0], 'gdacs-hazards');
  assert.equal(h.published[0][1].length, 1);
  assert.match(h.published[0][1][0].title, /Earthquake · Indonesia/);
  assert.equal(h.layer.getStats().count, 1);
  assert.equal(h.layer.getAnalystRecords().length, 1);
  assert.equal(h.layer.getAnalystRecords()[0].id, 'EQ1577696');
  h.layer.destroy(h.viewer);
});

test('zero GDACS events is a steady state, not an error', async () => {
  const h = harness({ events: [] });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.deepEqual(h.published[0][1], []);
  assert.equal(h.layer.getStats().count, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the layer usable and records the error', async () => {
  const h = harness({ events: [QUAKE] });
  assert.equal(await h.layer.update(h.viewer), true);
  const failing = createGdacsLayer({
    source: {
      getSnapshot: async () => {
        throw new Error('GDACS HTTP 502');
      },
    },
    overlayHost: {
      setEntries(...args) {
        h.published.push(args);
      },
      setVisible(...args) {
        h.visible.push(args);
      },
      clearSource(...args) {
        h.cleared.push(args);
      },
    },
  });
  failing.init(h.viewer);
  failing.enable(h.viewer);
  assert.equal(await failing.update(h.viewer), false);
  assert.match(failing.getStats().error, /GDACS HTTP 502/);
  failing.destroy(h.viewer);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay', () => {
  const h = harness({ events: [QUAKE] });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.cleared[0][0], 'gdacs-hazards');
  assert.equal(h.sources.length, 0);
});
