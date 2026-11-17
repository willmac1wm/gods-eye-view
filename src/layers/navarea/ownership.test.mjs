// src/layers/navarea/ownership.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavareaLayer } from './index.js';

const SNAPSHOT = {
  fetchedAt: 1,
  stale: false,
  bulletinDate: '131651Z NOV',
  inForceCount: 18,
  warnings: [
    {
      id: 'NAVAREA IV 1097/26',
      number: 1097,
      year: 26,
      area: 'CARIBBEAN SEA. ANTIGUA AND BARBUDA.',
      text: 'DERELICT VESSEL CAPSIZED AND ADRIFT IN 17-02.98N 061-57.65W AT 122007Z NOV.',
      positions: [{ lat: 17.04967, lon: -61.96083 }],
      positionParse: true,
      category: 'wreck',
      issuedAt: '131431Z NOV 26',
    },
    {
      id: 'NAVAREA IV 1050/26',
      number: 1050,
      year: 26,
      area: 'CARIBBEAN SEA.',
      text: 'GENERAL NOTICE WITH NO POSITION.',
      positions: [],
      positionParse: false,
      category: 'other',
      issuedAt: '131200Z NOV 26',
    },
  ],
};

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
  const layer = createNavareaLayer({
    source: source ?? { getSnapshot: async () => SNAPSHOT },
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
    resolve(SNAPSHOT);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    assert.equal(h.events.length, 0);
    h.layer.destroy(h.viewer);
  }
});

test('update publishes one label per warning with a position', async () => {
  const h = harness();
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'navarea-warnings');
  // 1097 pins; 1050 has no position, so it lists but does not pin.
  assert.equal(h.events[0][1].length, 1);
  assert.match(h.events[0][1][0].title, /NAVAREA IV 1097\/26 · wreck/);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().inForceCount, 18);
  assert.equal(h.layer.getStats().bulletinDate, '131651Z NOV');
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness();
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['navarea-warnings']);
  assert.deepEqual(h.visible.at(-1), ['navarea-warnings', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per warning, pinned or not', async () => {
  const h = harness();
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'NAVAREA IV 1097/26');
  assert.equal(records[0].category, 'wreck');
  assert.equal(records[1].id, 'NAVAREA IV 1050/26');
  assert.equal(records[1].positionParse, false);
  h.layer.destroy(h.viewer);
});

test('a snapshot failure marks the error and returns false', async () => {
  const h = harness({
    getSnapshot: async () => {
      throw new Error('NGA HTTP 503');
    },
  });
  assert.equal(await h.layer.update(h.viewer), false);
  assert.equal(h.layer.getStats().count, 0);
  assert.match(h.layer.getStats().error, /NGA HTTP 503/);
  h.layer.destroy(h.viewer);
});
