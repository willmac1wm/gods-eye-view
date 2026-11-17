import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHistoryOverlayEntries,
  createHistorySummaryEntry,
  mapAnalystRecord,
} from './model.js';

const T0 = 1794772800000;

const aircraft = [
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.0, lon: -74.9, alt: 5000, speed: 200, track: 90, seenAt: T0 },
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.01, lon: -74.89, alt: 5100, speed: 201, track: 91, seenAt: T0 + 10 * 60_000 },
  { hex: 'a2', kind: 'mil', flight: 'RCH1', lat: 39.1, lon: -74.8, alt: 20000, speed: 400, track: 270, seenAt: T0 + 30 * 60_000 },
];

const feed = [
  { id: 'f1', source: 'firewire', sourceLabel: 'Fire Wire', cat: 'fire', type: 'DISPATCH', title: 'Structure fire', lat: 39.0, lng: -74.9, pubMs: T0 + 2 * 60_000 },
  { id: 'f2', source: 'nws', sourceLabel: 'NWS', cat: 'weather', type: 'ALERT', title: 'Freeze Warning', lat: 39.0, lng: -74.9, pubMs: T0 + 20 * 60_000 },
];

test('overlay entries show latest positions at the cursor, never the future', () => {
  const entries = createHistoryOverlayEntries({
    aircraftRows: aircraft,
    feedRows: feed,
    cursorMs: T0 + 15 * 60_000,
  });
  // a1 at its T0+10m position, a2 not yet; f1 in the 15-min lookback.
  assert.equal(entries.length, 2);
  assert.match(entries[0].title, /N123/);
  assert.match(entries[0].title, /10/); // seen time is in the title
  assert.match(entries[1].title, /Structure fire/);
});

test('overlay entries at a later cursor show both aircraft', () => {
  const entries = createHistoryOverlayEntries({
    aircraftRows: aircraft,
    feedRows: feed,
    cursorMs: T0 + 30 * 60_000,
  });
  assert.equal(entries.length, 3);
  assert.match(entries[1].title, /RCH1/);
});

test('summary entry reports the empty window honestly', () => {
  const entry = createHistorySummaryEntry({
    status: { aircraftRows: 4, feedRows: 3, oldestMs: T0, newestMs: T0 + 60 * 60_000 },
    cursorMs: T0 + 5 * 60 * 60_000,
    fromMs: T0 + 5 * 60 * 60_000,
    untilMs: T0 + 6 * 60 * 60_000,
    aircraftShown: 0,
    feedShown: 0,
  });
  assert.match(entry.title, /No stored positions in this window/);
  assert.match(entry.details[0], /Stored/);
});

test('summary entry shows counts at the cursor', () => {
  const entry = createHistorySummaryEntry({
    status: { aircraftRows: 4, feedRows: 3, oldestMs: T0, newestMs: T0 + 60 * 60_000 },
    cursorMs: T0 + 30 * 60_000,
    fromMs: T0,
    untilMs: T0 + 60 * 60_000,
    aircraftShown: 2,
    feedShown: 1,
  });
  assert.match(entry.title, /2 aircraft · 1 feed/);
});

test('mapAnalystRecord separates aircraft from feed rows', () => {
  const air = mapAnalystRecord(aircraft[0], 0);
  assert.equal(air.id, 'HISTORY-AIR-a1-1794772800000');
  assert.equal(air.flight, undefined);
  assert.equal(air.title, 'N123');
  const item = mapAnalystRecord(feed[0], 0);
  assert.equal(item.id, 'HISTORY-FEED-f1');
  assert.equal(item.title, 'Structure fire');
});
