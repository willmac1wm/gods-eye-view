// src/layers/gdacs/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countGdacsByAlertLevel,
  countGdacsByType,
  filterGdacsEvents,
  normalizeAlertLevel,
  normalizeEventType,
  normalizeGdacsEvent,
  normalizeGdacsSnapshot,
  sortGdacsEvents,
} from './records.js';

// Fixtures are verbatim live GDACS items from 2026-11-17, as the server
// provider extracts them (raw RSS fields, not fetched at test time).
const QUAKE = {
  title:
    'Green earthquake (Magnitude 6.6M, Depth:68km) in Indonesia 16/11/2026 21:11 UTC, 6 thousand in MMI V.',
  description:
    'On 11/16/2026 9:11:17 PM, an earthquake occurred in Indonesia potentially affecting 6 thousand in MMI V. The earthquake had Magnitude 6.6M, Depth:68km.',
  link: 'http://www.gdacs.org/report.aspx?eventtype=EQ&eventid=1577696',
  pubDate: 'Mon, 16 Nov 2026 21:26:52 GMT',
  fromDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  toDate: 'Mon, 16 Nov 2026 21:11:17 GMT',
  eventType: 'EQ',
  alertLevel: 'Green',
  alertScore: '0',
  eventId: '1577696',
  episodeId: '1746999',
  isCurrent: 'true',
  country: 'Indonesia',
  iso3: 'IDN',
  glide: null,
  lat: '-6.0804',
  lon: '131.4868',
  georssPoint: '-6.0804 131.4868',
  severity: { text: 'Magnitude 6.6M, Depth:68km', unit: 'M', value: '6.6' },
  population: { text: '6 thousand in MMI V', unit: 'in MMI V', value: '6100' },
};

const CYCLONE = {
  title:
    'Orange notification for tropical cyclone AKVAN-26. Population affected by Category 1 (120 km/h) wind speeds or higher is 0  (11.162 million in Tropical Storm).',
  description:
    'From 16/11/2026 to 17/11/2026, a Tropical Storm (maximum wind speed of 93 km/h) AKVAN-26 was active in NorthIndian. The cyclone affects these countries: India (vulnerability High). Estimated population affected by category 1 (120 km/h) wind speeds or higher is 0  (11.162 million in tropical storm).',
  link: 'http://www.gdacs.org/report.aspx?eventtype=TC&eventid=1001351',
  pubDate: 'Mon, 16 Nov 2026 20:06:39 GMT',
  fromDate: 'Mon, 16 Nov 2026 18:00:00 GMT',
  toDate: 'Tue, 17 Nov 2026 06:00:00 GMT',
  eventType: 'TC',
  alertLevel: 'Orange',
  alertScore: '2',
  eventId: '1001351',
  isCurrent: 'true',
  country: 'India',
  iso3: 'IND',
  glide: null,
  lat: '12',
  lon: '87.3',
  georssPoint: '12 87.3',
  severity: {
    text: 'Tropical Storm (maximum wind speed of 93 km/h)',
    unit: 'km/h',
    value: '92.592',
  },
  population: {
    text: 'Population affected by Category 1 (120 km/h) wind speeds or higher is 0 (21.554 million in Tropical Storm)',
    unit: 'Pop74',
    value: '0',
  },
};

const WILDFIRE = {
  title: 'Green forest fire notification in Australia',
  description:
    'On 15/11/2026, a forest fire started in Australia,  until 17/11/2026.',
  link: 'http://www.gdacs.org/report.aspx?eventtype=WF&eventid=1033903',
  pubDate: 'Tue, 17 Nov 2026 08:02:23 GMT',
  fromDate: 'Sun, 15 Nov 2026 00:00:00 GMT',
  toDate: 'Tue, 17 Nov 2026 00:00:00 GMT',
  eventType: 'WF',
  alertLevel: 'Green',
  eventId: '1033903',
  isCurrent: 'true',
  country: 'Australia',
  lat: '-17.499406179715603',
  lon: '124.84233451930538',
  georssPoint: '-17.499406179715603 124.84233451930538',
};

const FLOOD = {
  title: 'Green flood alert in South Africa',
  link: 'http://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104286',
  fromDate: 'Sun, 15 Nov 2026 01:00:00 GMT',
  toDate: 'Tue, 17 Nov 2026 01:00:00 GMT',
  eventType: 'FL',
  alertLevel: 'Green',
  alertScore: '1',
  eventId: '1104286',
  country: 'South Africa',
  iso3: 'ZAF',
  lat: '-26.904354',
  lon: '27.456125',
  severity: { text: 'Magnitude 0', unit: '', value: '0' },
  population: { text: '0 deaths', unit: 'Population Affected', value: '0' },
};

test('the Indonesia M6.6 quake normalizes with its GDACS fields intact', () => {
  const row = normalizeGdacsEvent(QUAKE);
  assert.equal(row.id, 'EQ1577696');
  assert.equal(row.type, 'EQ');
  assert.equal(row.typeLabel, 'Earthquake');
  assert.equal(row.alertLevel, 'Green');
  assert.equal(row.alertRank, 1);
  assert.equal(row.country, 'Indonesia');
  assert.equal(row.iso3, 'IDN');
  assert.equal(row.lat, -6.0804);
  assert.equal(row.lon, 131.4868);
  assert.equal(row.hasPosition, true);
  assert.equal(row.severity.value, 6.6);
  assert.equal(row.severity.unit, 'M');
  assert.equal(row.population.value, 6100);
  assert.equal(row.isCurrent, true);
  assert.equal(row.fromDate, '2026-11-16T21:11:17.000Z');
});

test('the Orange cyclone outranks Green events and keeps its wind severity', () => {
  const row = normalizeGdacsEvent(CYCLONE);
  assert.equal(row.id, 'TC1001351');
  assert.equal(row.typeLabel, 'Tropical cyclone');
  assert.equal(row.alertLevel, 'Orange');
  assert.equal(row.alertRank, 2);
  assert.equal(row.alertScore, 2);
  assert.equal(row.country, 'India');
  assert.equal(row.severity.unit, 'km/h');
  assert.equal(row.severity.value, 92.592);
});

test('unknown types, levels, and missing ids are dropped, not guessed', () => {
  assert.equal(normalizeGdacsEvent({ ...QUAKE, eventType: 'XX' }), null);
  assert.equal(normalizeGdacsEvent({ ...QUAKE, alertLevel: 'Yellow' }), null);
  assert.equal(normalizeGdacsEvent({ ...QUAKE, eventId: '' }), null);
  assert.equal(normalizeGdacsEvent({ ...QUAKE, title: '' }), null);
  assert.equal(normalizeGdacsEvent(null), null);
  assert.equal(normalizeEventType('EQ'), 'EQ');
  assert.equal(normalizeEventType('XX'), null);
  assert.equal(normalizeAlertLevel('Red'), 'Red');
  assert.equal(normalizeAlertLevel('Yellow'), null);
});

test('an unpositioned event is kept for the list and flagged, not dropped', () => {
  const row = normalizeGdacsEvent({ ...FLOOD, lat: null, lon: null });
  assert.equal(row.hasPosition, false);
  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
  assert.equal(row.country, 'South Africa');
});

test('georss:point is the fallback when the geo:Point block is absent', () => {
  const row = normalizeGdacsEvent({
    ...WILDFIRE,
    lat: null,
    lon: null,
    georssPoint: '-17.499406179715603 124.84233451930538',
  });
  assert.equal(row.hasPosition, true);
  assert.equal(row.lat, -17.499406179715603);
  const bad = normalizeGdacsEvent({
    ...WILDFIRE,
    lat: '999',
    lon: '0',
    georssPoint: null,
  });
  assert.equal(bad.hasPosition, false);
});

test('sorting puts the Orange cyclone first, then newest Green', () => {
  const rows = [QUAKE, CYCLONE, WILDFIRE, FLOOD].map(normalizeGdacsEvent);
  const sorted = sortGdacsEvents(rows);
  assert.deepEqual(
    sorted.map((row) => row.id),
    ['TC1001351', 'WF1033903', 'EQ1577696', 'FL1104286'],
  );
});

test('the wildfire filter collapses a wildfire-heavy feed', () => {
  const rows = [QUAKE, CYCLONE, WILDFIRE, FLOOD].map(normalizeGdacsEvent);
  assert.deepEqual(
    filterGdacsEvents(rows, ['EQ', 'TC']).map((row) => row.id),
    ['EQ1577696', 'TC1001351'],
  );
  assert.equal(filterGdacsEvents(rows, []).length, 4);
  assert.deepEqual(countGdacsByType(rows), { EQ: 1, TC: 1, WF: 1, FL: 1 });
  assert.deepEqual(countGdacsByAlertLevel(rows), {
    Green: 3,
    Orange: 1,
    Red: 0,
  });
});

test('a malformed snapshot is rejected whole; junk rows are dropped', () => {
  assert.equal(normalizeGdacsSnapshot(null), null);
  assert.equal(normalizeGdacsSnapshot({ events: [] }), null);
  assert.equal(
    normalizeGdacsSnapshot({ fetchedAt: 1_793_123_456_789 }),
    null,
  );
  const snapshot = normalizeGdacsSnapshot({
    fetchedAt: 1_793_123_456_789,
    stale: false,
    ttlMs: 900_000,
    events: [QUAKE, { nope: true }, CYCLONE],
  });
  assert.equal(snapshot.count, 2);
  assert.equal(snapshot.events[0].id, 'EQ1577696');
  const empty = normalizeGdacsSnapshot({
    fetchedAt: 1_793_123_456_789,
    events: [],
  });
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.events, []);
});
