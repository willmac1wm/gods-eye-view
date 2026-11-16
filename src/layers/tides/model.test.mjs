import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  TIDES_OVERLAY_SOURCE_ID,
  TIDES_OVERLAY_COHORT_LIMIT,
  TIDE_STAGE_COLORS,
  stageColor,
  createTidesOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { ANALYST_LAYERS } from '../../data/analystEngine.js';

const row = {
  stationId: '8536110',
  name: 'Cape May',
  lat: 38.9683,
  lon: -74.96,
  observedFtMllw: 2.536,
  observedTime: '2026-11-15 21:12',
  predictedFtMllw: 1.949,
  residualFt: 0.587,
  floodStage: 'none',
  trend: 'rising',
};

test('stageColor maps each flood stage and defaults unknown stages to none', () => {
  assert.equal(stageColor('none'), Cesium.Color.SKYBLUE);
  assert.equal(stageColor('minor'), Cesium.Color.YELLOW);
  assert.equal(stageColor('moderate'), Cesium.Color.ORANGE);
  assert.equal(stageColor('major'), Cesium.Color.RED);
  assert.equal(stageColor('unknown'), Cesium.Color.SKYBLUE);
  assert.equal(stageColor(undefined), Cesium.Color.SKYBLUE);
  assert.deepEqual(TIDE_STAGE_COLORS, {
    none: Cesium.Color.SKYBLUE,
    minor: Cesium.Color.YELLOW,
    moderate: Cesium.Color.ORANGE,
    major: Cesium.Color.RED,
  });
});

test('createTidesOverlayEntry labels the gauge with level, trend, and surge', () => {
  const position = Cesium.Cartesian3.fromDegrees(-74.96, 38.9683);
  const entry = createTidesOverlayEntry({ id: '8536110', position, row });
  assert.equal(entry.id, '8536110');
  assert.equal(entry.position, position);
  assert.equal(entry.variant, 'label');
  assert.equal(entry.title, 'Cape May 2.5′ ▲');
  assert.equal(entry.subtitle, '+0.59′ surge');
  assert.equal(entry.accent, Cesium.Color.SKYBLUE.toCssColorString());
  assert.equal(entry.priority, 59);
  assert.equal(entry.interactive, false);

  const falling = createTidesOverlayEntry({
    id: '8534720',
    position,
    row: { ...row, name: 'Atlantic City', observedFtMllw: 2.673, residualFt: -0.12, trend: 'falling' },
  });
  assert.equal(falling.title, 'Atlantic City 2.7′ ▼');
  assert.equal(falling.subtitle, '-0.12′ surge');

  // Priority orders major above minor above none, whatever the residual.
  const priority = (stage, residualFt) =>
    createTidesOverlayEntry({
      id: 'x',
      position,
      row: { ...row, floodStage: stage, residualFt },
    }).priority;
  assert.ok(priority('major', 0) > priority('minor', 9.99));
  assert.ok(priority('minor', 0) > priority('none', 9.99));
  assert.equal(priority('major', 0), 3000);
  assert.equal(priority('none', 0), 0);

  // No residual: no subtitle, no surge text in the title.
  const noResidual = createTidesOverlayEntry({
    id: 'x',
    position,
    row: { ...row, residualFt: null, trend: null },
  });
  assert.equal(noResidual.subtitle, null);
  assert.equal(noResidual.title, 'Cape May 2.5′');
});

test('overlay constants name the tides source and cap the cohort at two gauges', () => {
  assert.equal(TIDES_OVERLAY_SOURCE_ID, 'tides');
  assert.equal(TIDES_OVERLAY_COHORT_LIMIT, 2);
});

test('mapAnalystRecord maps a full row JSON-safe with epoch time', () => {
  const record = mapAnalystRecord(row);
  assert.deepEqual(record, {
    id: '8536110',
    station: 'Cape May',
    observedFtMllw: 2.536,
    predictedFtMllw: 1.949,
    residualFt: 0.587,
    floodStage: 'none',
    trend: 'rising',
    lat: 38.9683,
    lon: -74.96,
    time: '2026-11-15 21:12',
    timeMs: Date.parse('2026-11-15 21:12'),
  });
  assert.equal(JSON.parse(JSON.stringify(record)).id, '8536110');
});

test('mapAnalystRecord nulls missing fields and falls back to an index id', () => {
  assert.deepEqual(mapAnalystRecord(null), {
    id: 'TIDE-0000',
    station: null,
    observedFtMllw: null,
    predictedFtMllw: null,
    residualFt: null,
    floodStage: null,
    trend: null,
    lat: null,
    lon: null,
    time: null,
    timeMs: null,
  });
  assert.equal(mapAnalystRecord({}, 3).id, 'TIDE-0003');
  const partial = mapAnalystRecord({ stationId: '  ', observedFtMllw: Number.NaN });
  assert.equal(partial.id, 'TIDE-0000');
  assert.equal(partial.observedFtMllw, null);
});

test('analyst records carry every field the voice manifest declares for tides', () => {
  const layer = ANALYST_LAYERS.tides;
  assert.ok(layer, 'tides is a queryable analyst layer');
  const record = mapAnalystRecord(row);
  for (const field of [...layer.numeric, ...layer.text, ...layer.flags, ...layer.time])
    assert.ok(Object.hasOwn(record, field), `tides record lacks ${field}`);
  assert.equal(typeof record.lat, 'number');
  assert.equal(typeof record.lon, 'number');
  assert.equal(layer.timeField, 'timeMs');
});
