import { inflateRawSync } from 'node:zlib';
import { readRequestBodyCapped } from '../common/request.js';
import { makeRateLimiter, clientKey } from '../common/rate-limit.js';
import { admitSameSiteKeyless } from '../common/same-site.js';

const MAX_UPLOAD = 4 * 1024 * 1024;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Minimal ZIP local-file reader for KMZ (stored or deflate). */
export function extractZipFiles(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buffer.length) break;
    const compressed = buffer.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else {
      offset = dataEnd;
      continue;
    }
    files.push({ name, data });
    offset = dataEnd;
  }
  return files;
}

function stripTags(xml) {
  return String(xml || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeKml(text) {
  const placemarks = [];
  const re = /<Placemark\b[\s\S]*?<\/Placemark>/gi;
  let match;
  while ((match = re.exec(text)) && placemarks.length < 200) {
    const block = match[0];
    const name = (block.match(/<name>([\s\S]*?)<\/name>/i) || [])[1];
    const coords = (block.match(/<coordinates>([\s\S]*?)<\/coordinates>/i) ||
      [])[1];
    const first = String(coords || '')
      .trim()
      .split(/\s+/)[0];
    const [lon, lat] = first
      ? first.split(',').map((n) => Number(n))
      : [NaN, NaN];
    placemarks.push({
      name: stripTags(name) || 'Placemark',
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
    });
  }
  const docName = stripTags(
    (text.match(/<Document>[\s\S]*?<name>([\s\S]*?)<\/name>/i) || [])[1] || '',
  );
  return {
    documentName: docName || null,
    placemarkCount: placemarks.length,
    placemarks,
  };
}

function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m?.[1] || m?.[2];
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(marker);
  while (start >= 0) {
    const after = start + marker.length;
    if (buffer[after] === 0x2d && buffer[after + 1] === 0x2d) break; // --
    const next = buffer.indexOf(marker, after);
    const chunk = buffer.subarray(
      after + (buffer[after] === 0x0d ? 2 : 0),
      next < 0 ? buffer.length : next,
    );
    const sep = chunk.indexOf(Buffer.from('\r\n\r\n'));
    if (sep >= 0) {
      const headers = chunk.subarray(0, sep).toString('utf8');
      if (/Content-Disposition:/i.test(headers)) {
        let body = chunk.subarray(sep + 4);
        if (
          body.length >= 2 &&
          body[body.length - 2] === 0x0d &&
          body[body.length - 1] === 0x0a
        ) {
          body = body.subarray(0, body.length - 2);
        }
        const name = /filename="([^"]+)"/i.exec(headers)?.[1] || 'upload.bin';
        return { filename: name, bytes: Buffer.from(body) };
      }
    }
    start = next;
  }
  return null;
}

export function createKmlParseHandler({
  fetchImpl: _fetchImpl,
} = {}) {
  const allow = makeRateLimiter({ windowMs: 60_000, max: 20, globalMax: 120 });

  return async function kmlHandler(req, res) {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      return res.end();
    }
    if (admitSameSiteKeyless(req, res)) return;
    if (!allow(clientKey(req))) return json(res, 429, { error: 'rate_limited' });

    let body;
    try {
      body = await readRequestBodyCapped(req, MAX_UPLOAD);
    } catch {
      return json(res, 413, { error: 'upload_too_large' });
    }
    const contentType = req.headers['content-type'] || '';
    let filename = 'upload.kml';
    let bytes = body;
    if (/multipart\/form-data/i.test(contentType)) {
      const parsed = parseMultipart(body, contentType);
      if (!parsed) return json(res, 400, { error: 'multipart_required' });
      filename = parsed.filename;
      bytes = parsed.bytes;
    }

    const lower = filename.toLowerCase();
    let kmlText = '';
    try {
      if (lower.endsWith('.kmz') || bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const files = extractZipFiles(bytes);
        const doc =
          files.find((f) => /doc\.kml$/i.test(f.name)) ||
          files.find((f) => /\.kml$/i.test(f.name));
        if (!doc) return json(res, 400, { error: 'kmz_missing_kml' });
        kmlText = doc.data.toString('utf8');
      } else {
        kmlText = bytes.toString('utf8');
      }
    } catch (error) {
      return json(res, 400, {
        error: 'parse_failed',
        detail: String(error?.message || error),
      });
    }
    if (!/<kml[\s>]/i.test(kmlText)) {
      return json(res, 400, { error: 'not_kml' });
    }
    const summary = summarizeKml(kmlText);
    return json(res, 200, {
      filename,
      ...summary,
      source: 'ops-kml-parse',
    });
  };
}
