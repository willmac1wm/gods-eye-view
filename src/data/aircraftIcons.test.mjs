// src/data/aircraftIcons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { aircraftIcon, ROTOR_FRAMES } from './aircraftIcons.js';

const KINDS = [
  'airliner',
  'widebody',
  'quadjet',
  'turboprop',
  'light',
  'glider',
  'fastjet',
  'bizjet',
  'uav',
  'helicopter',
  'vehicle',
  'station',
  'tr3b',
  'tr3bHot',
];
const PX = 480;

/** Farthest painted pixel from the centre, in the 96-unit glyph space. */
async function halfExtent(uri) {
  const svg = Buffer.from(uri.split(',')[1], 'base64');
  const { data, info } = await sharp(svg)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let half = 0;
  const c = info.width / 2;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
      half = Math.max(half, c - x, x + 1 - c, c - y, y + 1 - c);
    }
  }
  return (half * 96) / info.width;
}

const decode = (uri) =>
  Buffer.from(uri.replace('data:image/svg+xml;base64,', ''), 'base64').toString(
    'utf8',
  );

test('every sprite fills the same extent, whatever its class', async () => {
  const extents = {};
  for (const kind of KINDS) {
    extents[kind] = await halfExtent(aircraftIcon(kind, PX));
  }
  for (let frame = 0; frame < ROTOR_FRAMES; frame++) {
    extents[`helicopter#${frame}`] = await halfExtent(
      aircraftIcon('helicopter', PX, frame),
    );
  }
  for (const [kind, half] of Object.entries(extents)) {
    assert.ok(Math.abs(half - 44) <= 0.6, `${kind}: ${half.toFixed(2)}`);
  }
});

test('aircraft icons are stable per kind and size without a ring', () => {
  assert.equal(aircraftIcon('airliner'), aircraftIcon('airliner'));
  assert.notEqual(aircraftIcon('airliner'), aircraftIcon('glider'));
  assert.notEqual(aircraftIcon('airliner'), aircraftIcon('airliner', 192));
  assert.equal(aircraftIcon('unknown-kind'), aircraftIcon('airliner'));
  assert.equal(decode(aircraftIcon('airliner')).includes('<circle'), false);
});

test('ringed aircraft icons draw a thin circle around the glyph', () => {
  const plain = aircraftIcon('airliner');
  const ringed = aircraftIcon('airliner', 64, undefined, { ring: true });
  assert.notEqual(ringed, plain);
  assert.equal(ringed, aircraftIcon('airliner', 64, undefined, { ring: true }));
  assert.equal(
    aircraftIcon('airliner', 192, undefined, { ring: true }),
    aircraftIcon('airliner', 192, undefined, { ring: true }),
  );
  assert.notEqual(
    aircraftIcon('airliner', 192, undefined, { ring: true }),
    aircraftIcon('airliner', 64, undefined, { ring: true }),
  );
  const svg = decode(ringed);
  assert.match(svg, /<circle cx="0" cy="0" r="45\.5"/);
  // The ring is the only circle in the plain airliner glyph set; the
  // helicopter's rotor disc is a different body and keeps its own rings.
  assert.match(svg, /stroke="white" stroke-width="5"/);
  assert.ok(svg.includes('<path'));
  // The ring is not scaled with the class glyph: every kind gets one size.
  assert.doesNotMatch(svg, /scale\([^)]*\)"><circle cx="0" cy="0" r="45\.5"/);
});

test('a ringed helicopter keeps its rotor frames', () => {
  const frames = new Set();
  for (let frame = 0; frame < ROTOR_FRAMES; frame++) {
    const ringed = aircraftIcon('helicopter', 64, frame, { ring: true });
    assert.notEqual(ringed, aircraftIcon('helicopter', 64, frame));
    assert.match(decode(ringed), /r="45\.5"/);
    frames.add(ringed);
  }
  assert.equal(frames.size, ROTOR_FRAMES);
});

test('the ring stays inside the 96-unit viewBox', async () => {
  for (const kind of KINDS) {
    const half = await halfExtent(
      aircraftIcon(kind, PX, undefined, { ring: true }),
    );
    assert.ok(half <= 48, `${kind}: ${half.toFixed(2)}`);
    assert.ok(half > 44.6, `${kind}: ring reaches past the glyph`);
  }
});
