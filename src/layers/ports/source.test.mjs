// src/layers/ports/source.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortsSource } from './source.js';

const TINY = {
  version: 1,
  generatedAt: '2026-11-17',
  ports: [{ id: 'cape-may', name: 'Cape May', lat: 38.95, lon: -74.905 }],
  chokepoints: [{ id: 'dover', name: 'Strait of Dover', lat: 51, lon: 1.5 }],
};

test('default source serves the bundled snapshot', () => {
  const snapshot = createPortsSource().getSnapshot();
  assert.equal(snapshot.ports.length, 10);
  assert.equal(snapshot.chokepoints.length, 9);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.errors, []);
});

test('an injected snapshot is validated, not trusted blindly', () => {
  const snapshot = createPortsSource({
    snapshot: {
      ...TINY,
      ports: [...TINY.ports, { id: 'bad', name: 'Bad' }],
    },
  }).getSnapshot();
  assert.equal(snapshot.ports.length, 1);
  assert.equal(snapshot.errors.length, 1);
});

test('an aborted signal throws before any work', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => createPortsSource().getSnapshot({ signal: controller.signal }),
    /aborted/,
  );
});
