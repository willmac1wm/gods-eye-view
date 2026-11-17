import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftIcon } from './aircraftIcons.js';

const decode = (uri) =>
  Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString(
    'utf8',
  );

test('aircraft icons are stable per kind and size without a ring', () => {
  assert.equal(aircraftIcon('airliner'), aircraftIcon('airliner'));
  assert.notEqual(aircraftIcon('airliner'), aircraftIcon('glider'));
  assert.notEqual(aircraftIcon('airliner'), aircraftIcon('airliner', 192));
  assert.equal(aircraftIcon('unknown-kind'), aircraftIcon('airliner'));
  assert.equal(decode(aircraftIcon('airliner')).includes('<circle'), false);
});

test('ringed aircraft icons draw a thin circle around the glyph', () => {
  const plain = aircraftIcon('airliner');
  const ringed = aircraftIcon('airliner', 64, { ring: true });
  assert.notEqual(ringed, plain);
  assert.equal(ringed, aircraftIcon('airliner', 64, { ring: true }));
  assert.equal(
    aircraftIcon('airliner', 192, { ring: true }),
    aircraftIcon('airliner', 192, { ring: true }),
  );
  assert.notEqual(
    aircraftIcon('airliner', 192, { ring: true }),
    aircraftIcon('airliner', 64, { ring: true }),
  );
  const svg = decode(ringed);
  assert.match(svg, /<circle cx="0" cy="0" r="45\.5"/);
  // The ring is the only circle in the plain airliner glyph set; the
  // helicopter's rotor disc is a different body and keeps its own rings.
  assert.match(svg, /stroke="white" stroke-width="5"/);
  assert.ok(svg.includes('<path'));
});
