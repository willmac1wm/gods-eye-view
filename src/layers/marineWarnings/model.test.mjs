import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  MARINE_WARNINGS_OVERLAY_SOURCE_ID,
  MARINE_WARNINGS_OVERLAY_COHORT_LIMIT,
  MARINE_WARNINGS_OVERLAY_COLLISION_CAPACITY,
  severityColor,
  createMarineWarningsOverlayEntry,
  selectMarineWarningsOverlayCohort,
  mapAnalystRecord,
} from './model.js';

test('overlay constants match the earthquakes cohort numbers', () => {
  assert.equal(MARINE_WARNINGS_OVERLAY_SOURCE_ID, 'marine-warnings');
  assert.equal(MARINE_WARNINGS_OVERLAY_COHORT_LIMIT, 96);
  assert.equal(MARINE_WARNINGS_OVERLAY_COLLISION_CAPACITY, 48);
});

test('severityColor maps the heuristic severities', () => {
  assert.equal(
    severityColor('high').toCssColorString(),
    Cesium.Color.RED.toCssColorString(),
  );
  assert.equal(
    severityColor('moderate').toCssColorString(),
    Cesium.Color.ORANGE.toCssColorString(),
  );
  assert.equal(
    severityColor('low').toCssColorString(),
    Cesium.Color.YELLOW.toCssColorString(),
  );
  assert.equal(
    severityColor('info').toCssColorString(),
    Cesium.Color.GRAY.toCssColorString(),
  );
  assert.equal(severityColor('bogus'), severityColor('moderate'));
  assert.equal(severityColor(undefined), severityColor('moderate'));
});

test('overlay entries label the BNM and surface polygon zones', () => {
  const position = Cesium.Cartesian3.fromDegrees(-74.2229, 38.9929);
  const entry = createMarineWarningsOverlayEntry({
    id: 'CGD-E:0478-26',
    position,
    row: {
      number: '0478-26',
      descriptor: 'HAZ OPS',
      area: 'NJ-ATLANTIC CITY OPERATING AREA (ACOA)',
      severity: 'high',
      polygon: true,
      vertices: 4,
      pubDateMs: Date.parse('2026-10-12T10:00:00Z'),
    },
  });
  assert.equal(entry.id, 'CGD-E:0478-26');
  assert.equal(entry.title, 'BNM 0478-26 · HAZ OPS');
  assert.equal(entry.subtitle, 'NJ-ATLANTIC CITY OPERATING AREA (ACOA)');
  assert.equal(entry.accent, Cesium.Color.RED.toCssColorString());
  assert.equal(entry.variant, 'label');
  assert.equal(entry.interactive, false);
  const point = createMarineWarningsOverlayEntry({
    id: 'SEC SDB:0283-26',
    position,
    row: {
      number: '0283-26',
      descriptor: 'ATON',
      area: 'DE - DELAWARE BAY',
      severity: 'moderate',
      polygon: false,
      pubDateMs: Date.parse('2026-11-13T10:00:00Z'),
    },
  });
  assert.equal(point.subtitle, 'DE - DELAWARE BAY');
  // Severity outranks recency: the older high warning sorts first.
  assert.ok(entry.priority > point.priority);
});

test('selectMarineWarningsOverlayCohort keeps the most severe, then newest', () => {
  const mk = (id, priority) => ({ id, priority });
  const entries = [
    mk('low-old', 1_000_000_001),
    mk('high-new', 3_000_000_002),
    mk('high-old', 3_000_000_001),
    mk('mod', 2_000_000_001),
  ];
  assert.deepEqual(
    selectMarineWarningsOverlayCohort(entries).map((e) => e.id),
    ['high-new', 'high-old', 'mod', 'low-old'],
  );
  assert.deepEqual(
    selectMarineWarningsOverlayCohort(entries, 2).map((e) => e.id),
    ['high-new', 'high-old'],
  );
  assert.deepEqual(selectMarineWarningsOverlayCohort(entries, 0), []);
  assert.deepEqual(selectMarineWarningsOverlayCohort(null), []);
  // The cohort never exceeds the limit, however many entries arrive.
  const many = Array.from({ length: 200 }, (_, i) => mk(`e-${i}`, i));
  assert.equal(selectMarineWarningsOverlayCohort(many).length, 96);
});

test('mapAnalystRecord is pure and null-safe', () => {
  assert.deepEqual(mapAnalystRecord({}, 3), {
    id: 'BNM-0003',
    originator: null,
    number: null,
    criticality: null,
    area: null,
    descriptor: null,
    severity: null,
    lat: null,
    lon: null,
    hasPosition: false,
    polygon: false,
    llnr: null,
    timeMs: null,
    cancelAtMs: null,
  });
  const record = mapAnalystRecord({
    stableId: 'CGD-E:0478-26',
    originator: 'CGD-E',
    number: '0478-26',
    criticality: 'SAFETY',
    area: 'NJ-ATLANTIC CITY OPERATING AREA (ACOA)',
    descriptor: 'HAZ OPS',
    severity: 'high',
    lat: 38.9929,
    lon: -74.2229,
    hasPosition: true,
    polygon: true,
    llnr: null,
    pubDateMs: 1_791_000_000_000,
    cancelAtMs: 1_791_100_000_000,
  });
  assert.equal(record.id, 'CGD-E:0478-26');
  assert.equal(record.severity, 'high');
  assert.equal(record.hasPosition, true);
  assert.equal(record.timeMs, 1_791_000_000_000);
});
