// src/layers/outbreaks/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutbreaksLayer } from './index.js';
import { createOutbreaksSource } from './source.js';

const payload = {
  fetchedAt: 1_793_123_456_789,
  stale: false,
  ttlMs: 86_400_000,
  arbonet: {
    ok: true,
    asOf: 'November 10, 2026',
    status: 'preliminary',
    states: [{ state: 'NJ', cases: 35, band: '>25' }],
    njCounties: [
      {
        fips: '34009',
        activity: 'Non-human activity',
        humanCases: 0,
        neuroinvasive: 0,
        donors: 0,
      },
    ],
  },
  don: {
    ok: true,
    items: [
      {
        id: 'DON626',
        title: 'Middle East respiratory syndrome (MERS) – Qatar',
        date: '13 November 2026',
        dateIso: '2026-11-13T00:00:00.000Z',
        url: 'https://www.who.int/2026-DON626',
      },
    ],
  },
};

function harness({ source } = {}) {
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
  const layer = createOutbreaksLayer({
    source:
      source ??
      createOutbreaksSource({
        fetchImpl: async () =>
          new Response(JSON.stringify(payload), { status: 200 }),
      }),
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

test('update publishes one county-seat anchor; stats count both halves', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0][0], 'outbreaks');
  assert.equal(h.published[0][1].length, 1);
  assert.match(h.published[0][1][0].title, /🦟/);
  assert.match(h.published[0][1][0].title, /35/);
  assert.equal(h.layer.getStats().count, 3);
  assert.equal(h.layer.getStats().stale, false);
  assert.equal(h.layer.getAnalystRecords().length, 3);
  assert.deepEqual(
    h.layer.getAnalystRecords().map((row) => row.kind),
    ['state', 'county', 'don'],
  );
  h.layer.destroy(h.viewer);
});

test('a failed refresh keeps the layer usable and records the error', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  const failing = createOutbreaksLayer({
    source: {
      getSnapshot: () => {
        throw new Error('Outbreaks HTTP 502');
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
  assert.match(failing.getStats().error, /Outbreaks HTTP 502/);
  failing.destroy(h.viewer);
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.equal(h.cleared.length, 1);
  assert.equal(h.cleared[0][0], 'outbreaks');
  assert.equal(h.sources.length, 0);
});
