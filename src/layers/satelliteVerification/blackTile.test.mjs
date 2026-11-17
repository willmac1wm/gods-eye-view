import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserBlackTile } from './blackTile.js';

function withBrowser({ pixels, throws = false } = {}) {
  const savedBitmap = globalThis.createImageBitmap;
  const savedDocument = globalThis.document;
  globalThis.createImageBitmap = async () => {
    if (throws) throw new Error('decode failed');
    return { close() {} };
  };
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(pixels) }),
      }),
    }),
  };
  return () => {
    if (savedBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = savedBitmap;
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  };
}

test('an all-black decode reports black; one bright sample reports real', async () => {
  const restore = withBrowser({ pixels: new Array(8 * 8 * 4).fill(0) });
  try {
    const isBlack = createBrowserBlackTile();
    assert.equal(
      await isBlack(new Uint8Array(1665).buffer),
      true,
    );
  } finally {
    restore();
  }
  const bright = new Array(8 * 8 * 4).fill(0);
  bright[0] = 58; // one sample at the live 2026-11-16 mean brightness
  bright[1] = 58;
  bright[2] = 58;
  const restoreBright = withBrowser({ pixels: bright });
  try {
    const isBlack = createBrowserBlackTile();
    assert.equal(await isBlack(new Uint8Array(5496).buffer), false);
  } finally {
    restoreBright();
  }
});

test('no decoder falls back to the byte-size heuristic', async () => {
  const savedBitmap = globalThis.createImageBitmap;
  const savedDocument = globalThis.document;
  delete globalThis.createImageBitmap;
  delete globalThis.document;
  try {
    const isBlack = createBrowserBlackTile();
    assert.equal(await isBlack(new Uint8Array(1665).buffer), true);
    assert.equal(await isBlack(new Uint8Array(5496).buffer), false);
  } finally {
    if (savedBitmap !== undefined) globalThis.createImageBitmap = savedBitmap;
    if (savedDocument !== undefined) globalThis.document = savedDocument;
  }
});

test('a failed decode falls back to the byte-size heuristic', async () => {
  const restore = withBrowser({ throws: true });
  try {
    const isBlack = createBrowserBlackTile();
    assert.equal(await isBlack(new Uint8Array(1665).buffer), true);
    assert.equal(await isBlack(new Uint8Array(11417).buffer), false);
  } finally {
    restore();
  }
});
