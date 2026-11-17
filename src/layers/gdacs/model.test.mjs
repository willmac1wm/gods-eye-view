// src/layers/gdacs/model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGdacsOverlayEntries,
  mapAnalystRecord,
  GDACS_OVERLAY_COHORT_LIMIT,
} from './model.js';
import { normalizeGdacsEvent } from './records.js';

const QUAKE = normalizeGdacsEvent({
  title: 'Green earthquake (Magnitude 6.6M, Depth:68km) in Indonesia',
  link: 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
  pubDate: 'Mon, 16 Nov 2026 21:26:52 GMT',
  fromDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  toDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  eventType: 'EQ',
  alertLevel: 'Green',
  eventId: '1577696',
  country: 'Indonesia',
  iso3: 'IDN',
  lat: '-6.0804',
  lon: '131.4868',
  severity: { text: 'Magnitude 6.6M, Depth:68km', unit: 'M', value: '6.6' },
  population: { text: '6 thousand in MMI V', unit: 'in MMI V', value: '6100' },
});

const CYCLONE = normalizeGdacsEvent({
  title: 'Orange notification for tropical cyclone AKVAN-26.',
  link: 'http://www.gdacs.org/report.aspx?eventtype=TC&eventid=1001351',
  pubDate: 'Mon, 16 Nov 2026 20:06:39 GMT',
  fromDate: 'Mon, 16 Nov 2026 18:00:00 GMT',
  toDate: 'Tue, 17 Nov 2026 06:00:00 GMT',
  eventType: 'TC',
  alertLevel: 'Orange',
  eventId: '1001351',
  country: 'India',
  iso3: 'IND',
  lat: '12',
  lon: '87.3',
  severity: {
    text: 'Tropical Storm (maximum wind speed of 93 km/h)',
    unit: 'km/h',
    value: '92.592',
  },
});

test('one label per positioned event, Red/Orange first, unpositioned skipped', () => {
  const unpositioned = normalizeGdacsEvent({
    title: 'Green flood alert in South Africa',
    eventType: 'FL',
    alertLevel: 'Green',
    eventId: '1104286',
    country: 'South Africa',
    lat: null,
    lon: null,
  });
  const entries = createGdacsOverlayEntries({
    events: [QUAKE, CYCLONE, unpositioned],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'gdacs-hazards-TC1001351');
  assert.match(entries[0].title, /Tropical cyclone · India/);
  assert.match(entries[0].subtitle, /GDACS Orange/);
  assert.equal(entries[1].id, 'gdacs-hazards-EQ1577696');
  assert.match(entries[1].title, /Earthquake · Indonesia/);
});

test('a wildfire-heavy day is capped at the cohort limit', () => {
  assert.equal(GDACS_OVERLAY_COHORT_LIMIT, 100);
  const many = Array.from({ length: 250 }, (_, i) =>
    normalizeGdacsEvent({
      title: `Green forest fire notification in Australia ${i}`,
      eventType: 'WF',
      alertLevel: 'Green',
      eventId: String(2000000 + i),
      country: 'Australia',
      lat: '-17.5',
      lon: '124.8',
    }),
  );
  assert.equal(
    createGdacsOverlayEntries({ events: many }).length,
    GDACS_OVERLAY_COHORT_LIMIT,
  );
});

test('the analyst record carries the GDACS fields, nothing more', () => {
  const record = mapAnalystRecord(QUAKE, 0);
  assert.equal(record.id, 'EQ1577696');
  assert.equal(record.type, 'EQ');
  assert.equal(record.alertLevel, 'Green');
  assert.equal(record.country, 'Indonesia');
  assert.equal(record.lat, -6.0804);
  assert.equal(record.severity, 'Magnitude 6.6M, Depth:68km');
  assert.equal(record.population, '6 thousand in MMI V');
  assert.equal(
    record.link,
    'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
  );
});
