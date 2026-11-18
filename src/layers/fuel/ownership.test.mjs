import assert from 'node:assert/strict';
import test from 'node:test';
import { createFuelLayer } from './index.js';

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
  const layer = createFuelLayer({
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
  latestWeek: '2026-11-09',
  series: {
    EMM_EPMR_PTE_R1Y_DPG: {
      seriesId: 'EMM_EPMR_PTE_R1Y_DPG',
      label: 'Regular gasoline — Central Atlantic (PADD 1B)',
      product: 'gasoline',
      area: 'Central Atlantic (PADD 1B)',
      proxy: true,
      unit: '$/GAL',
      values: [
        { period: '2026-11-09', value: 4.146 },
        { period: '2026-11-02', value: 4.232 },
      ],
    },
    EMD_EPD2D_PTE_R1Y_DPG: {
      seriesId: 'EMD_EPD2D_PTE_R1Y_DPG',
      label: 'On-highway diesel — Central Atlantic (PADD 1B)',
      product: 'diesel',
      area: 'Central Atlantic (PADD 1B)',
      proxy: true,
      unit: '$/GAL',
      values: [{ period: '2026-11-09', value: 6.412 }],
    },
    W_EPD2F_PRS_SNJ_DPG: {
      seriesId: 'W_EPD2F_PRS_SNJ_DPG',
      label: 'Residential heating oil — New Jersey',
      product: 'heating-oil',
      area: 'New Jersey',
      proxy: false,
      unit: '$/GAL',
      values: [{ period: '2026-11-09', value: 6.052 }],
    },
  },
  latest: {
    EMM_EPMR_PTE_R1Y_DPG: { period: '2026-11-09', value: 4.146 },
    EMD_EPD2D_PTE_R1Y_DPG: { period: '2026-11-09', value: 6.412 },
    W_EPD2F_PRS_SNJ_DPG: { period: '2026-11-09', value: 6.052 },
  },
  heatingOil: { state: 'current', ageDays: 7 },
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

test('update publishes one price-ticker label and stats carry the week', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.equal(await h.layer.update(h.viewer), true);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], 'fuel-prices');
  assert.equal(h.events[0][1].length, 1);
  assert.equal(
    h.events[0][1][0].title,
    '⛽ Gas $4.15 · Diesel $6.41',
  );
  // Labelled as the regional average, never as a county or NJ pump price.
  assert.match(h.events[0][1][0].subtitle, /^Mid-Atlantic average · week of/);
  assert.match(h.events[0][1][0].subtitle, /Nov 9, 2026/);
  const stats = h.layer.getStats();
  assert.equal(stats.count, 3);
  assert.equal(stats.gasPadd1b, 4.146);
  assert.equal(stats.dieselPadd1b, 6.412);
  assert.equal(stats.heatingOilNj, 6.052);
  assert.equal(stats.heatingOilState, 'current');
  assert.equal(stats.latestWeek, '2026-11-09');
  h.layer.destroy(h.viewer);
});

test('double init throws and destroy clears the overlay source', () => {
  const h = harness({ getSnapshot: async () => snapshot });
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
  h.layer.destroy(h.viewer);
  assert.deepEqual(h.cleared.at(-1), ['fuel-prices']);
  assert.deepEqual(h.visible.at(-1), ['fuel-prices', false]);
  assert.equal(h.sources.length, 0);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('analyst records carry one row per series, latest value only', async () => {
  const h = harness({ getSnapshot: async () => snapshot });
  await h.layer.update(h.viewer);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 3);
  const gas = records.find(
    (record) => record.series === 'EMM_EPMR_PTE_R1Y_DPG',
  );
  assert.equal(gas.value, 4.146);
  assert.equal(gas.period, '2026-11-09');
  assert.equal(gas.regionalProxy, true);
  assert.equal(gas.timeMs, Date.parse('2026-11-09T12:00:00Z'));
  const heat = records.find(
    (record) => record.series === 'W_EPD2F_PRS_SNJ_DPG',
  );
  assert.equal(heat.regionalProxy, false);
  assert.equal(heat.area, 'New Jersey');
  h.layer.destroy(h.viewer);
});
