import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVdl2OverlayEntry,
  mapAnalystRecord,
  selectVdl2OverlayCohort,
  vdl2CategoryLabel,
  vdl2SeverityColor,
} from './model.js';
import { normalizeVdl2Snapshot } from './records.js';

const row = {
  id: '8135359152',
  stableId: 'vdl2:8135359152',
  flight: 'MX501',
  tail: 'N219BZ',
  fromHex: 'A12345',
  label: 'H1',
  mode: '2',
  frequency: 136.65,
  stationIdent: 'PhillyRox-VDLM',
  stationAirport: 'KPHL',
  category: 'mayday',
  severity: 'critical',
  undecoded: false,
  hasPosition: true,
  lat: 39.5,
  lon: -74.9,
  timeMs: 1_793_123_456_000,
  url: 'https://api.airframes.io/v1/messages/8135359152',
};

test('mapAnalystRecord maps one row, with no raw text anywhere', () => {
  const record = mapAnalystRecord(row, 0);
  assert.equal(record.id, 'vdl2:8135359152');
  assert.equal(record.flight, 'MX501');
  assert.equal(record.tail, 'N219BZ');
  assert.equal(record.fromHex, 'A12345');
  assert.equal(record.stationIdent, 'PhillyRox-VDLM');
  assert.equal(record.stationAirport, 'KPHL');
  assert.equal(record.category, 'mayday');
  assert.equal(record.severity, 'critical');
  assert.equal(record.undecoded, false);
  assert.equal(record.lat, 39.5);
  assert.equal(record.lon, -74.9);
  assert.equal(record.hasPosition, true);
  assert.equal(record.timeMs, 1_793_123_456_000);
  assert.equal(record.url, 'https://api.airframes.io/v1/messages/8135359152');
  assert.equal('text' in record, false);
});

test('mapAnalystRecord falls back to an index id and clears a remote fix', () => {
  const record = mapAnalystRecord({}, 3);
  assert.equal(record.id, 'vdl2-0003');
  assert.equal(record.flight, null);
  assert.equal(record.hasPosition, false);
  assert.equal(record.undecoded, false);
});

test('vdl2CategoryLabel covers every known category', () => {
  assert.equal(vdl2CategoryLabel('mayday'), 'Mayday call');
  assert.equal(vdl2CategoryLabel('ground stop'), 'Ground stop');
  assert.equal(vdl2CategoryLabel('undecoded'), 'Undecoded frame');
  assert.equal(vdl2CategoryLabel('bird strike'), 'Bird strike');
  assert.equal(vdl2SeverityColor('critical').toCssColorString(), 'rgb(255,0,0)');
});

test('overlay entries rank severity first, then recency', () => {
  const position = { fake: true };
  const entry = createVdl2OverlayEntry({ id: row.stableId, position, row });
  assert.equal(entry.title, 'MX501 · Mayday call');
  assert.equal(entry.subtitle, 'N219BZ · PhillyRox-VDLM');
  assert.equal(entry.variant, 'label');
  const cohort = selectVdl2OverlayCohort([
    createVdl2OverlayEntry({
      id: 'a',
      position,
      row: { ...row, category: 'undecoded', severity: 'info', timeMs: 2_000 },
    }),
    createVdl2OverlayEntry({
      id: 'b',
      position,
      row: { ...row, category: 'diversion', severity: 'high', timeMs: 1_000 },
    }),
    entry,
  ]);
  assert.deepEqual(
    cohort.map((item) => item.id),
    [row.stableId, 'b', 'a'],
  );
  assert.deepEqual(selectVdl2OverlayCohort([], 0), []);
});

test('a normalized snapshot round-trips through the analyst seam', () => {
  const snapshot = normalizeVdl2Snapshot({
    fetchedAt: 1_793_123_456_789,
    stale: false,
    heardLocal: 100,
    heardTruncated: true,
    stationFlagged: true,
    stationFlagReason: 'Rate anomaly detected',
    rows: [
      row,
      { ...row, id: '8135359153', stableId: 'vdl2:8135359153', category: 'undecoded', severity: 'info', undecoded: true, hasPosition: false, lat: null, lon: null },
    ],
  });
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.categorizedCount, 1);
  assert.equal(snapshot.undecodedCount, 1);
  const record = mapAnalystRecord(
    snapshot.rows.find((item) => item.category === 'undecoded'),
    1,
  );
  assert.equal(record.category, 'undecoded');
  assert.equal(record.hasPosition, false);
});
