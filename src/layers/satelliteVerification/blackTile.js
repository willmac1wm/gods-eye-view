import {
  SATELLITE_BLACK_TILE_SIZE_BYTES,
  SATELLITE_BLACK_TILE_THRESHOLD,
} from './policy.js';

/**
 * Browser-aware black-tile test (layer package only — never in the source
 * package, which must not reach browser globals). Decodes the JPEG via
 * createImageBitmap and samples it on an 8×8 canvas: a tile is black when
 * every sample is below the brightness threshold. Where no decoder exists
 * (Node / SSR / a failed decode) it falls back to the byte-size heuristic
 * — the same rule the source uses by default. The decoder is checked at
 * call time, so a late-arriving browser API is picked up.
 *
 * Verified live 2026-11-17: MODIS Terra for 2026-11-17 is HTTP 200 but an
 * all-black JPEG (1,665 B, mean brightness 0) while 2026-11-16 is a real
 * scene (5,496 B, mean 58) — a 200 alone is not imagery.
 */
export function createBrowserBlackTile() {
  return async (buffer) => {
    const bytes = buffer?.byteLength ?? 0;
    const createBitmap = globalThis?.createImageBitmap;
    const canCanvas =
      typeof createBitmap === 'function' &&
      typeof globalThis?.document?.createElement === 'function';
    if (!canCanvas) return bytes < SATELLITE_BLACK_TILE_SIZE_BYTES;
    try {
      const bitmap = await createBitmap(
        new Blob([buffer], { type: 'image/jpeg' }),
      );
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d');
      if (!ctx) return bytes < SATELLITE_BLACK_TILE_SIZE_BYTES;
      ctx.drawImage(bitmap, 0, 0, 8, 8);
      const { data } = ctx.getImageData(0, 0, 8, 8);
      bitmap.close?.();
      for (let i = 0; i < data.length; i += 4) {
        const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (grey >= SATELLITE_BLACK_TILE_THRESHOLD) return false;
      }
      return true;
    } catch {
      return bytes < SATELLITE_BLACK_TILE_SIZE_BYTES;
    }
  };
}
