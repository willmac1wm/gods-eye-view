import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodePng, encodePng, diffFloodTiles } from './png.js';

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const palettePng = readFileSync(
  path.join(fixtures, 'fixtures', 'png-palette.png'),
);
const rgbaPng = readFileSync(path.join(fixtures, 'fixtures', 'png-rgba.png'));

// Palette: [black, flood-blue, green, white]; tRNS alpha [0, 200, 255, 255].
// Pixels: row 0: 0,1,2,3 — row 1: 1,0,3,2.
const PALETTE_RGBA = [
  0, 0, 0, 0, 37, 99, 235, 200, 0, 255, 0, 255, 255, 255, 255, 255, 37, 99, 235,
  200, 0, 0, 0, 0, 255, 255, 255, 255, 0, 255, 0, 255,
];

const RGBA_PIXELS = [
  37, 99, 235, 200, 0, 0, 0, 0, 0, 255, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0,
  37, 99, 235, 200, 10, 20, 30, 40, 0, 0, 0, 128,
];

test('decodePng reads a paletted PNG with transparency', () => {
  const decoded = decodePng(palettePng);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.data), PALETTE_RGBA);
});

test('decodePng reads an RGBA PNG', () => {
  const decoded = decodePng(rgbaPng);
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.data), RGBA_PIXELS);
});

test('encodePng round-trips through decodePng', () => {
  const original = { width: 4, height: 2, data: Buffer.from(RGBA_PIXELS) };
  const decoded = decodePng(encodePng(original));
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 2);
  assert.deepEqual(Array.from(decoded.data), RGBA_PIXELS);
});

test('decodePng rejects a bad signature and truncated input', () => {
  assert.throws(
    () => decodePng(Buffer.from('not a png')),
    /png_invalid_signature/,
  );
  assert.throws(() => decodePng(palettePng.subarray(0, 20)), /png_truncated/);
});

test('diffFloodTiles keeps newly wet pixels, drops base water and green', () => {
  const level = {
    width: 2,
    height: 2,
    data: Buffer.from([
      37, 99, 235, 255, 37, 99, 235, 255, 0, 200, 0, 255, 37, 99, 235, 255,
    ]),
  };
  const base = {
    width: 2,
    height: 2,
    data: Buffer.from([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0, 0, 0, 0, 0]),
  };
  const diffed = diffFloodTiles(level, base);
  assert.deepEqual(
    Array.from(diffed.data),
    [37, 99, 235, 200, 0, 0, 0, 0, 0, 0, 0, 0, 37, 99, 235, 200],
  );
});

test('diffFloodTiles returns null when nothing newly floods', () => {
  const level = { width: 1, height: 1, data: Buffer.from([0, 0, 0, 0]) };
  const base = { width: 1, height: 1, data: Buffer.from([0, 0, 0, 0]) };
  assert.equal(diffFloodTiles(level, base), null);
});
