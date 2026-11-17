// src/layers/ports/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import snapshot from './portsSnapshot.json' with { type: 'json' };
import {
  inPortsWindow,
  normalizeChokepoint,
  normalizePort,
  numValue,
  validateSnapshot,
} from './records.js';

test('numValue never coerces null, empty, or boolean to 0', () => {
  assert.equal(numValue(null), null);
  assert.equal(numValue(''), null);
  assert.equal(numValue(true), null);
  assert.equal(numValue('13.7'), 13.7);
  assert.equal(numValue('abc'), null);
});

test('a port needs an id, a name, and a position inside the window', () => {
  assert.equal(normalizePort(null), null);
  assert.equal(normalizePort({ name: 'No Id', lat: 39, lon: -75 }), null);
  assert.equal(
    normalizePort({ id: 'x', name: 'No Position' }),
    null,
  );
  // Outside the Mid-Atlantic window: dropped, not moved.
  assert.equal(
    normalizePort({ id: 'x', name: 'Far', lat: 51, lon: 1.5 }),
    null,
  );
  const row = normalizePort({
    id: 'philadelphia',
    name: 'Philadelphia',
    locode: 'USPHL',
    state: 'PA',
    lat: 39.95,
    lon: -75.1333,
    channelDepthM: 13.7,
    depthClass: 'deep',
  });
  assert.equal(row.kind, 'port');
  assert.equal(row.channelDepthM, 13.7);
  assert.equal(row.depthClass, 'deep');
});

test('an unknown depth class is dropped, never invented', () => {
  const row = normalizePort({
    id: 'x',
    name: 'X',
    lat: 39,
    lon: -75,
    depthClass: 'enormous',
  });
  assert.equal(row.depthClass, null);
});

test('inPortsWindow bounds the regional snapshot', () => {
  assert.equal(inPortsWindow({ lat: 39.12, lon: -74.85 }), true);
  assert.equal(inPortsWindow({ lat: 35.9, lon: -75 }), false);
  assert.equal(inPortsWindow({ lat: 39, lon: -72.9 }), false);
});

test('a chokepoint needs an id, a name, and a position; no window check', () => {
  assert.equal(normalizeChokepoint(null), null);
  const row = normalizeChokepoint({
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lat: 26.6,
    lon: 56.5,
    connects: 'Persian Gulf – Gulf of Oman',
  });
  assert.equal(row.kind, 'chokepoint');
  assert.equal(row.connects, 'Persian Gulf – Gulf of Oman');
});

test('validateSnapshot drops bad rows and names them', () => {
  const checked = validateSnapshot({
    version: 1,
    generatedAt: '2026-11-17',
    ports: [
      { id: 'good', name: 'Good', lat: 39, lon: -75 },
      { id: 'bad', name: 'Bad' },
    ],
    chokepoints: [{ id: 'also-bad', name: 'Also Bad', lat: 1 }],
  });
  assert.equal(checked.ports.length, 1);
  assert.equal(checked.chokepoints.length, 0);
  assert.equal(checked.errors.length, 2);
  assert.match(checked.errors.join(' '), /bad/);
});

test('validateSnapshot reports a missing snapshot, never an empty map', () => {
  const checked = validateSnapshot(null);
  assert.deepEqual(checked.ports, []);
  assert.deepEqual(checked.chokepoints, []);
  assert.deepEqual(checked.errors, ['snapshot missing']);
});

// --- Pinned snapshot contents (verified 2026-11-17) ---
test('snapshot carries 10 Mid-Atlantic ports', () => {
  const checked = validateSnapshot(snapshot);
  assert.equal(checked.errors.length, 0);
  assert.equal(checked.ports.length, 10);
  assert.equal(checked.version, 1);
  for (const port of checked.ports) {
    assert.equal(inPortsWindow(port), true);
  }
});

const EXPECTED_PORTS = {
  'cape-may': [38.95, -74.905, null],
  'atlantic-city': [39.366667, -74.416667, null],
  philadelphia: [39.95, -75.1333, 13.7],
  'wilmington-de': [39.7183, -75.52, 11.6],
  baltimore: [39.266667, -76.583333, 15.2],
  'hampton-roads': [36.97, -76.35, 15.2],
  'newport-news': [36.966667, -76.433333, null],
  'new-york': [40.7, -74.0167, null],
  newark: [40.7, -74.15, 8],
  brooklyn: [40.67, -74.02, 13],
};

for (const [id, [lat, lon, channelDepthM]] of Object.entries(
  EXPECTED_PORTS,
)) {
  test(`pinned port ${id} keeps its verified coordinate`, () => {
    const checked = validateSnapshot(snapshot);
    const port = checked.ports.find((row) => row.id === id);
    assert.ok(port, `missing port ${id}`);
    assert.equal(port.lat, lat);
    assert.equal(port.lon, lon);
    assert.equal(port.channelDepthM, channelDepthM);
  });
}

test('Wilmington DE carries no UN/LOCODE — USILM is Wilmington NC', () => {
  const checked = validateSnapshot(snapshot);
  const port = checked.ports.find((row) => row.id === 'wilmington-de');
  assert.equal(port.locode, null);
  const nc = checked.ports.find((row) => row.locode === 'USILM');
  assert.equal(nc, undefined);
});

test('snapshot carries 9 chokepoints at verified coordinates', () => {
  const checked = validateSnapshot(snapshot);
  assert.equal(checked.chokepoints.length, 9);
  const expected = {
    hormuz: [26.6, 56.5],
    malacca: [4.0, 100.0],
    'bab-el-mandeb': [12.583, 43.333],
    suez: [30.705, 32.34417],
    panama: [9.08, -79.68],
    gibraltar: [35.95, -5.5],
    'turkish-straits': [40.2, 26.4],
    dover: [51.0, 1.5],
    'taiwan-strait': [24.81111, 119.92833],
  };
  for (const [id, [lat, lon]] of Object.entries(expected)) {
    const point = checked.chokepoints.find((row) => row.id === id);
    assert.ok(point, `missing chokepoint ${id}`);
    assert.equal(point.lat, lat);
    assert.equal(point.lon, lon);
  }
});
