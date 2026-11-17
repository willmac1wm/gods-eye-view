import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanNotamId,
  parseAixmXmlToFeatures,
  selectTfrItems,
} from './tfrs.js';

const AIXM = `<TFR>
<dateEffective>2026-11-16T12:00:00Z</dateEffective>
<dateExpire>2026-11-16T20:00:00Z</dateExpire>
<TFRAreaGroup>
<txtName>Inner Ring</txtName>
<valDistVerUpper>3000</valDistVerUpper>
<uomDistVerUpper>FT</uomDistVerUpper>
<valDistVerLower>0</valDistVerLower>
<uomDistVerLower>FT</uomDistVerLower>
<geoLat>39.000000N</geoLat><geoLong>74.900000W</geoLong>
<geoLat>39.000000N</geoLat><geoLong>74.800000W</geoLong>
<geoLat>38.900000N</geoLat><geoLong>74.800000W</geoLong>
<geoLat>38.900000N</geoLat><geoLong>74.900000W</geoLong>
</TFRAreaGroup>
<TFRAreaGroup>
<txtName>Outer Ring</txtName>
<valDistVerUpper>18000</valDistVerUpper>
<valDistVerLower>3000</valDistVerLower>
<geoLat>39.100000N</geoLat><geoLong>75.000000W</geoLong>
<geoLat>39.100000N</geoLat><geoLong>74.700000W</geoLong>
<geoLat>38.800000N</geoLat><geoLong>74.700000W</geoLong>
</TFRAreaGroup>
</TFR>`;

test('cleanNotamId converts a NOTAM id for the FAA detail URL', () => {
  assert.equal(cleanNotamId('6/4120'), '6_4120');
  assert.equal(cleanNotamId(' 6/4120 '), '6_4120');
});

test('parseAixmXmlToFeatures builds one polygon per area group', () => {
  const features = parseAixmXmlToFeatures(AIXM, {
    notam_id: '6/4120',
    type: 'VIP',
    description: 'VIP movement',
    facility: 'ZNY',
    state: 'NJ',
  });
  assert.equal(features.length, 2);
  const [inner, outer] = features;
  assert.equal(inner.id, 'tfr_6_4120_1');
  assert.equal(inner.properties.area_name, 'Inner Ring');
  assert.equal(inner.properties.alt_low, 0);
  assert.equal(inner.properties.alt_high, 3000);
  assert.equal(inner.properties.alt_low_str, '0 FT');
  assert.equal(inner.properties.alt_high_str, '3000 FT');
  assert.equal(inner.properties.is_vip, true);
  assert.equal(inner.properties.is_regional, true);
  assert.equal(inner.properties.source, 'FAA AIS');
  assert.equal(
    inner.properties.faa_url,
    'https://tfr.faa.gov/save_pages/detail_6_4120.html',
  );
  assert.equal(inner.properties.effective, '2026-11-16T12:00:00Z');
  assert.equal(inner.properties.expire, '2026-11-16T20:00:00Z');
  // Closed ring: 4 corners + closing point.
  assert.equal(inner.geometry.coordinates[0].length, 5);
  assert.deepEqual(inner.geometry.coordinates[0][0], [-74.9, 39]);
  assert.deepEqual(inner.geometry.coordinates[0][4], [-74.9, 39]);
  // Outer ring defaults the missing UOMs to FT and closes itself.
  assert.equal(outer.properties.alt_high, 18000);
  assert.equal(outer.geometry.coordinates[0].length, 4);
});

test('parseAixmXmlToFeatures drops groups with fewer than 3 coordinates', () => {
  const features = parseAixmXmlToFeatures(
    '<TFRAreaGroup><txtName>Thin</txtName>' +
      '<geoLat>39.000000N</geoLat><geoLong>74.900000W</geoLong>' +
      '<geoLat>39.000000N</geoLat><geoLong>74.800000W</geoLong></TFRAreaGroup>',
    { notam_id: '1/1' },
  );
  assert.equal(features.length, 0);
});

test('selectTfrItems prioritises the Mid-Atlantic, VIP and Security, then caps the rest', () => {
  const list = [
    { notam_id: 'a', facility: 'ZLA', state: 'CA', type: 'HAZARD' },
    { notam_id: 'b', facility: 'ZNY', state: 'NJ', type: 'HAZARD' },
    { notam_id: 'c', facility: 'ZLA', state: 'CA', type: 'VIP' },
    { notam_id: 'd', facility: 'ZLA', state: 'CA', type: 'SECURITY' },
    ...Array.from({ length: 40 }, (_, i) => ({
      notam_id: `x${i}`,
      facility: 'ZLA',
      state: 'CA',
      type: 'HAZARD',
    })),
  ];
  const selected = selectTfrItems(list);
  assert.deepEqual(
    selected.slice(0, 3).map((item) => item.notam_id),
    ['b', 'c', 'd'],
  );
  assert.equal(selected.length, 3 + 30);
});
