import assert from 'node:assert/strict';
import test from 'node:test';
import { createSatelliteVerificationLayer } from './index.js';

const TEMPLATE =
  'https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-16/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';

function snapshotFor(date) {
  const d = date ?? '2026-11-17';
  return {
    requestedDate: d,
    date: d,
    source: 'MODIS_Terra',
    tileUrl: TEMPLATE.replace('2026-11-16', d),
    tileUrlTemplate: TEMPLATE.replace('2026-11-16', d),
    tileStatus: 'live',
    products: [
      {
        id: 'e4de0c65-5ae6-4034-999c-a688454733b7',
        name: 'S2A_MSIL1C_20230525T154941_N0510_R054_T18SVJ_20240908T142632.SAFE',
        sensingDate: '2023-05-25',
        tile: 'T18SVJ',
        level: 'L1C',
        countyTile: true,
      },
    ],
    catalogueAvailable: true,
    worldviewUrl: `https://worldview.earthdata.nasa.gov/?v=-75.15,38.9,-74.55,39.35&l=MODIS_Terra_CorrectedReflectance_TrueColor&t=${d}`,
    copernicusBrowserUrl: `https://browser.dataspace.copernicus.eu/?lat=39&lng=-74.9&zoom=10&datasetId=S2L2A&date=${d}`,
    fetchedAt: Date.parse('2026-11-17T14:00:00.000Z'),
  };
}

function harness({ source } = {}) {
  const datesSeen = [];
  const fakeSource = source ?? {
    async getSnapshot({ date } = {}) {
      datesSeen.push(date ?? null);
      return snapshotFor(date);
    },
  };
  const entries = [];
  const overlayHost = {
    setEntries(id, list, options) {
      entries.push({ id, list, options });
    },
    setVisible(id, visible) {
      overlayHost.visible[id] = visible;
    },
    clearSource(id) {
      overlayHost.cleared ??= [];
      overlayHost.cleared.push(id);
    },
    visible: {},
    cleared: [],
  };
  const drape = {
    shown: [],
    hidden: [],
    scenes: [],
    show(slotId, options) {
      drape.shown.push({ slotId, options });
      return { shown: true, kind: 'globe' };
    },
    hide(slotId) {
      drape.hidden.push(slotId);
    },
    setScene(scene) {
      drape.scenes.push(scene);
    },
    getState: () => ({
      kind: 'globe',
      slots: drape.shown.map(({ slotId }) => ({ slotId })),
    }),
    destroy: () => {
      drape.destroyed = true;
    },
    destroyed: false,
  };
  const opened = [];
  const layer = createSatelliteVerificationLayer({
    source: fakeSource,
    overlayHost,
    drape,
    openUrl: (url) => opened.push(url),
    now: () => Date.parse('2026-11-17T14:00:00.000Z'),
  });
  return { layer, overlayHost, drape, entries, datesSeen, opened, fakeSource };
}

test('enable fetches the latest date, labels it and drapes it', async () => {
  const { layer, overlayHost, drape, datesSeen } = harness();
  layer.init({});
  layer.enable({});
  const updated = await layer.update({});
  assert.equal(updated, true);
  assert.deepEqual(datesSeen, [null]);
  assert.equal(overlayHost.visible['satellite-verification'], true);
  assert.equal(drape.shown.length, 1);
  assert.equal(drape.shown[0].slotId, 'a');
  const stats = layer.getStats();
  assert.equal(stats.date, '2026-11-17');
  assert.equal(stats.tileStatus, 'live');
  assert.equal(stats.count, 1);
  assert.equal(layer.getAnalystRecords().length, 1);
  assert.equal(layer.getAnalystRecords()[0].tile, 'T18SVJ');
});

test('a date chip fetches that date; Latest goes back to newest', async () => {
  const { layer, datesSeen } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  assert.equal(layer.setParams({ dateA: '2026-11-16' }), true);
  await layer.update({});
  assert.ok(datesSeen.includes('2026-11-16'));
  assert.equal(layer.getStats().date, '2026-11-16');
  assert.equal(layer.setParams({ dateA: '2026-11-16' }), false);
  assert.equal(layer.setParams({ latest: true }), true);
  await layer.update({});
  assert.equal(layer.getStats().date, '2026-11-17');
  assert.equal(layer.setParams({ latest: true }), false);
  assert.equal(layer.setParams({ dateA: 'not-a-date' }), false);
});

test('a Sentinel product jumps the compare drape to its sensing date', async () => {
  const { layer, drape, datesSeen } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  const controls = layer.getRowControls();
  assert.equal(controls.list.items.length, 1);
  const product = controls.list.items[0];
  assert.equal(layer.setParams(product.params), true);
  await layer.update({});
  assert.ok(datesSeen.includes('2023-05-25'));
  assert.ok(drape.shown.some((s) => s.slotId === 'b'));
  assert.equal(layer.getStats().showB, true);
  const compareChip = controls.chips.find((c) => c.id === 'compare');
  compareChip.onClick();
  await layer.update({});
  assert.equal(layer.getStats().showB, false);
});

test('date chips carry the right params; link chips open the framed URLs', async () => {
  const { layer, opened } = harness();
  layer.init({});
  layer.enable({});
  await layer.update({});
  const controls = layer.getRowControls();
  const minus1 = controls.chips.find((c) => c.id === 'date-minus-1d');
  assert.deepEqual(minus1.params, { dateA: '2026-11-16' });
  const worldview = controls.chips.find((c) => c.id === 'open-worldview');
  worldview.onClick();
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith('https://worldview.earthdata.nasa.gov/'));
  assert.ok(opened[0].includes('t=2026-11-17'));
  const browser = controls.chips.find(
    (c) => c.id === 'open-copernicus-browser',
  );
  browser.onClick();
  assert.equal(opened.length, 2);
  assert.ok(opened[1].includes('browser.dataspace.copernicus.eu'));
});

test('a failed refresh keeps the layer enabled and records the error', async () => {
  const failing = {
    async getSnapshot() {
      throw new Error('GIBS unreachable');
    },
  };
  const { layer } = harness({ source: failing });
  layer.init({});
  layer.enable({});
  const updated = await layer.update({});
  assert.equal(updated, false);
  assert.match(layer.getStats().error, /GIBS unreachable/);
  assert.equal(layer.getAnalystRecords().length, 0);
});

test('update while disabled returns false; disable clears the drape + overlay', async () => {
  const { layer, overlayHost, drape } = harness();
  layer.init({});
  assert.equal(await layer.update({}), false);
  layer.enable({});
  await layer.update({});
  layer.disable({});
  assert.equal(overlayHost.visible['satellite-verification'], false);
  assert.ok(overlayHost.cleared.includes('satellite-verification'));
  assert.ok(drape.hidden.includes('a'));
  assert.equal(layer.getAnalystRecords().length, 0);
  layer.destroy();
  assert.equal(drape.destroyed, true);
});

test('construction + init guards', () => {
  const { layer } = harness();
  assert.throws(
    () => createSatelliteVerificationLayer({ overlayHost: {} }),
    /snapshot source/,
  );
  assert.throws(
    () =>
      createSatelliteVerificationLayer({
        source: { getSnapshot: async () => ({}) },
      }),
    /overlay host/,
  );
  layer.init({});
  assert.throws(() => layer.init({}), /already initialized/);
  layer.destroy();
});
