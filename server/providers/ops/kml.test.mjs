import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractZipFiles, summarizeKml } from './kml.js';

test('summarizeKml extracts placemarks', () => {
  const summary = summarizeKml(`<?xml version="1.0"?>
    <kml><Document><name>Test</name>
      <Placemark><name>Hydrant A</name><Point><coordinates>-74.92,38.93,0</coordinates></Point></Placemark>
    </Document></kml>`);
  assert.equal(summary.documentName, 'Test');
  assert.equal(summary.placemarkCount, 1);
  assert.equal(summary.placemarks[0].name, 'Hydrant A');
  assert.equal(summary.placemarks[0].lat, 38.93);
});

test('extractZipFiles reads deflated kmz member', () => {
  const kml = Buffer.from(
    '<?xml version="1.0"?><kml><Document><name>Z</name></Document></kml>',
  );
  const compressed = deflateRawSync(kml);
  const name = Buffer.from('doc.kml');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  const zip = Buffer.concat([header, name, compressed]);
  const files = extractZipFiles(zip);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'doc.kml');
  assert.match(files[0].data.toString('utf8'), /<kml>/);
});
