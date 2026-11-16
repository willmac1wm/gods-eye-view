import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createGpsjamLayer } from './index.js';
import { normalizeGpsjamSnapshot } from './records.js';

const boundary = [
  [-74.655086, 39.503507],
  [-74.958634, 39.450412],
  [-75.047572, 39.234937],
  [-74.835067, 39.073298],
  [-74.533806, 39.125839],
  [-74.442775, 39.340569],
];

const payload = {
  date: '2026-11-15',
  source: 'merged',
  suspect: false,
  fetchedAt: 1_793_123_456_789,
  stale: false,
  cells: [
    {
      hex: '842aad9ffffffff',
      lat: 39.288,
      lon: -74.745,
      boundary,
      good: 726,
      bad: 0,
      total: 726,
    },
    {
      hex: '842aad7ffffffff',
      lat: 38.752,
      lon: -75.522,
      boundary,
      good: 514,
      bad: 1,
      total: 515,
    },
  ],
};

const snapshot = () => normalizeGpsjamSnapshot(payload);

function harness(getSnapshot) {
  const added = [];
  const viewer = {
    scene: {
      groundPrimitives: {
        add(value) {
          added.push(value);
        },
        remove(value) {
          added.splice(added.indexOf(value), 1);
        },
      },
      requestRender() {},
    },
  };
  const layer = createGpsjamLayer({
    source: {
      async getSnapshot(...args) {
        return getSnapshot(...args);
      },
    },
  });
  layer.init(viewer);
  layer.enable();
  return { layer, viewer, added };
}

function collection(h) {
  return h.added[0];
}

function primitives(h) {
  return collection(h)?.get(0);
}

function instanceColors(h) {
  const fill = primitives(h);
  assert.ok(fill, 'a ground fill primitive was added');
  return fill.geometryInstances.map((instance) => ({
    id: instance.id,
    color: [...instance.attributes.color.value],
  }));
}

function expectedColor(css, alpha) {
  // ColorGeometryInstanceAttribute stores the color as bytes 0–255.
  const color = Cesium.Color.fromCssColorString(css).withAlpha(alpha);
  return [
    Math.round(color.red * 255),
    Math.round(color.green * 255),
    Math.round(color.blue * 255),
    Math.round(color.alpha * 255),
  ];
}

function closeTo(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= 1,
      `component ${i}: ${actual[i]} vs ${expected[i]}`,
    );
}

test('createGpsjamLayer requires a snapshot source and single init', () => {
  assert.throws(() => createGpsjamLayer({}), /snapshot source/);
  assert.throws(() => createGpsjamLayer(), /snapshot source/);
  const h = harness(snapshot);
  assert.throws(() => h.layer.init(h.viewer), /already initialized/);
});

test('update draws one polygon per cell, coloured by level', async () => {
  const h = harness(snapshot);
  assert.equal(await h.layer.update(), true);
  const colors = instanceColors(h);
  assert.equal(colors.length, 2);
  assert.deepEqual(
    colors.map((entry) => entry.id),
    ['gpsjam-daily:842aad7ffffffff', 'gpsjam-daily:842aad9ffffffff'],
  );
  closeTo(colors[0].color, expectedColor('#3fb950', 0.3));
  closeTo(colors[1].color, expectedColor('#3fb950', 0.3));
  const stats = h.layer.getStats();
  assert.equal(stats.count, 2);
  assert.deepEqual(stats.levels, { low: 2, medium: 0, high: 0 });
  assert.equal(stats.date, '2026-11-15');
  assert.equal(stats.source, 'merged');
  assert.equal(stats.suspect, false);
  assert.equal(stats.stale, false);
  assert.equal(stats.lastUpdate, 1_793_123_456_789);
  assert.equal(stats.error, null);
  assert.equal(stats.fallback, false);
});

test('a level change re-renders; an identical refresh does not', async () => {
  let current = snapshot();
  const h = harness(async () => current);
  assert.equal(await h.layer.update(), true);
  const firstFill = primitives(h);
  assert.equal(await h.layer.update(), true);
  assert.equal(primitives(h), firstFill, 'same cells keep the same fill');
  assert.equal(h.added.length, 1);

  current = normalizeGpsjamSnapshot({
    ...payload,
    cells: [
      {
        hex: '842aad9ffffffff',
        lat: 39.288,
        lon: -74.745,
        boundary,
        good: 6,
        bad: 3,
        total: 9,
      },
    ],
  });
  assert.equal(await h.layer.update(), true);
  assert.notEqual(primitives(h), firstFill, 'changed cells rebuild the fill');
  assert.equal(h.added.length, 1);
  const colors = instanceColors(h);
  assert.equal(colors.length, 1);
  closeTo(colors[0].color, expectedColor('#f85149', 0.55));
  assert.deepEqual(h.layer.getStats().levels, {
    low: 0,
    medium: 0,
    high: 1,
  });
});

test('row controls lead with the UTC date and the not-live warning', async () => {
  const h = harness(snapshot);
  const before = h.layer.getRowControls();
  assert.match(before.info, /not loaded yet/);
  assert.equal(await h.layer.update(), true);
  const controls = h.layer.getRowControls();
  assert.match(controls.info, /Daily aggregate for 2026-11-15 UTC · not live/);
  assert.doesNotMatch(controls.info, /incomplete/);
  assert.match(controls.infoTitle, /not proof of jamming or spoofing/);
  assert.match(controls.infoTitle, /Green hexes are shown too/);
  assert.deepEqual(
    controls.legend.map((entry) => entry.label),
    [
      'Low-accuracy score > 10%',
      'Low-accuracy score 2–10%',
      'Low-accuracy score < 2%',
    ],
  );
  assert.deepEqual(
    controls.legend.map((entry) => entry.count),
    [0, 0, 2],
  );
  assert.match(controls.legend[0].blurb, /not proof of jamming/);
  assert.match(controls.legend[0].blurb, /Cells need 3 aircraft/);
  assert.equal(controls.legend[1].blurb, undefined);
});

test('a suspect day is flagged in the row controls and stats', async () => {
  const h = harness(async () =>
    normalizeGpsjamSnapshot({ ...payload, suspect: true }),
  );
  assert.equal(await h.layer.update(), true);
  assert.match(
    h.layer.getRowControls().info,
    /gpsjam\.org flags this day as incomplete/,
  );
  assert.equal(h.layer.getStats().suspect, true);
});

test('analyst records are one per cell at the centroid, and empty while disabled', async () => {
  const h = harness(snapshot);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  assert.equal(await h.layer.update(), true);
  const records = h.layer.getAnalystRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'gpsjam-daily:842aad7ffffffff');
  assert.equal(records[0].date, '2026-11-15');
  assert.equal(records[0].source, 'merged');
  assert.equal(records[0].hasPosition, true);
  assert.equal(records[0].aircraft, 515);
  assert.deepEqual(
    h.layer.getAnalystRecords(1).map((row) => row.id),
    ['gpsjam-daily:842aad7ffffffff'],
  );
  h.layer.disable();
  assert.deepEqual(h.layer.getAnalystRecords(), []);
});

test('a failed update keeps the last cells and reports the error', async () => {
  let fail = false;
  const h = harness(async () => {
    if (fail) throw new Error('GPSJam HTTP 502');
    return snapshot();
  });
  assert.equal(await h.layer.update(), true);
  assert.equal(h.layer.getStats().count, 2);
  fail = true;
  assert.equal(await h.layer.update(), false);
  assert.equal(h.layer.getStats().count, 2);
  assert.equal(h.layer.getStats().error, 'GPSJam HTTP 502');
  assert.match(h.layer.getRowControls().info, /2026-11-15/);
});

test('disable hides the primitives and destroy removes them', async () => {
  const h = harness(snapshot);
  assert.equal(await h.layer.update(), true);
  assert.equal(collection(h).show, true);
  h.layer.disable();
  assert.equal(collection(h).show, false);
  h.layer.destroy(h.viewer);
  assert.equal(h.added.length, 0);
  assert.equal(h.layer.getStats().count, 0);
});
