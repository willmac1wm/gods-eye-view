// Minimal PNG decode/encode for server-side tile work — no new dependency
// (sharp is dev-only in this repo, so providers cannot use it).
// Supports 8-bit, non-interlaced PNGs, color types 0 (gray), 2 (RGB),
// 3 (palette + PLTE/tRNS), 4 (gray+alpha), 6 (RGBA). Adam7, 16-bit and
// other depths throw: the NOAA SLR tiles this exists for are 8-bit
// paletted (color type 3, verified live 2026-11-16).
import { inflateSync, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Decode a PNG to { width, height, data: Buffer } in RGBA order. */
export function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('png_invalid_signature');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  let offset = 8;
  let sawIhdr = false;
  let sawIend = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error('png_truncated');
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      sawIhdr = true;
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!sawIhdr || !sawIend) throw new Error('png_truncated');
  if (bitDepth !== 8) throw new Error('png_unsupported_bit_depth');
  if (interlace !== 0) throw new Error('png_interlaced_unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('png_unsupported_color_type');
  if (colorType === 3 && !palette) throw new Error('png_palette_missing');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('png_truncated');
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(
      raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) row[i] = (row[i] + a) & 0xff;
      else if (filter === 2) row[i] = (row[i] + b) & 0xff;
      else if (filter === 3) row[i] = (row[i] + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[i] = (row[i] + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error('png_unknown_filter');
      }
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      if (colorType === 6) {
        pixels[dst] = row[src];
        pixels[dst + 1] = row[src + 1];
        pixels[dst + 2] = row[src + 2];
        pixels[dst + 3] = row[src + 3];
      } else if (colorType === 2) {
        pixels[dst] = row[src];
        pixels[dst + 1] = row[src + 1];
        pixels[dst + 2] = row[src + 2];
        pixels[dst + 3] = 255;
      } else if (colorType === 3) {
        const index = row[src];
        const base = index * 3;
        pixels[dst] = palette[base] ?? 0;
        pixels[dst + 1] = palette[base + 1] ?? 0;
        pixels[dst + 2] = palette[base + 2] ?? 0;
        pixels[dst + 3] =
          transparency && index < transparency.length
            ? transparency[index]
            : 255;
      } else if (colorType === 4) {
        pixels[dst] = row[src];
        pixels[dst + 1] = row[src];
        pixels[dst + 2] = row[src];
        pixels[dst + 3] = row[src + 1];
      } else {
        pixels[dst] = row[src];
        pixels[dst + 1] = row[src];
        pixels[dst + 2] = row[src];
        pixels[dst + 3] = 255;
      }
    }
    previous = row;
  }
  return { width, height, data: pixels };
}

/** Encode { width, height, data: RGBA Buffer } as an 8-bit RGBA PNG. */
export function encodePng({ width, height, data }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('png_invalid_dimensions');
  }
  if (!data || data.length < width * height * 4) {
    throw new Error('png_data_short');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.subarray(y * width * 4, (y + 1) * width * 4)).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Flood diff (port of old app/flood_map.py diff_tiles): pixels that are
 * water at the forecast level but dry at normal high tide, minus the
 * green NOAA paints for low-lying-but-disconnected ground. Painted one
 * flood blue (37, 99, 235, 200). Returns null when nothing floods.
 */
export function diffFloodTiles(level, base) {
  if (
    !level ||
    !base ||
    level.width !== base.width ||
    level.height !== base.height
  ) {
    throw new Error('png_dimension_mismatch');
  }
  const { width, height } = level;
  const out = Buffer.alloc(width * height * 4);
  let kept = 0;
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const levelAlpha = level.data[o + 3];
    const baseAlpha = base.data[o + 3];
    const green = level.data[o + 1] > 150 && level.data[o + 2] <= 150;
    if (levelAlpha > 0 && baseAlpha === 0 && !green) {
      out[o] = 37;
      out[o + 1] = 99;
      out[o + 2] = 235;
      out[o + 3] = 200;
      kept += 1;
    }
  }
  if (!kept) return null;
  return { width, height, data: out };
}
