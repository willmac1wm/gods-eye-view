import assert from 'node:assert/strict';
import test from 'node:test';
import {
  feedAt,
  formatReplayTime,
  normalizeAircraftRow,
  normalizeFeedRow,
  normalizeHistoryStatus,
  normalizeHistoryWindow,
  positionsAt,
  timeBuckets,
} from './records.js';

const T0 = 1794772800000;
const HOUR = 3600 * 1000;

const aircraft = [
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.0, lon: -74.9, alt: 5000, speed: 200, track: 90, seen_at: T0 },
  { hex: 'a1', kind: 'air', flight: 'N123', lat: 39.01, lon: -74.89, alt: 5100, speed: 201, track: 91, seen_at: T0 + 10 * 60_000 },
  { hex: 'a2', kind: 'air', flight: 'N456', lat: 39.1, lon: -74.8, alt: 3000, speed: 150, track: 180, seen_at: T0 + 30 * 60_000 },
].map((raw, i) => normalizeAircraftRow(raw, i));

const feed = [
  { id: 'f1', source: 'firewire', source_label: 'Fire Wire', cat: 'fire', type: 'DISPATCH', title: 'Structure fire', lat: 39.0, lng: -74.9, pub_ms: T0 + 2 * 60_000 },
  { id: 'f2', source: 'nws', source_label: 'NWS', cat: 'weather', type: 'ALERT', title: 'Freeze Warning', lat: 39.0, lng: -74.9, pub_ms: T0 + 20 * 60_000 },
].map((raw, i) => normalizeFeedRow(raw, i));

test('normalizeAircraftRow drops rows without position or time', () => {
  assert.equal(normalizeAircraftRow({ hex: 'x', lat: 39, lon: -74.9 }), null);
  assert.equal(normalizeAircraftRow({ hex: 'x', lat: 39, seen_at: T0 }), null);
  assert.equal(normalizeAircraftRow(null), null);
  const row = normalizeAircraftRow(aircraft[0] && { ...aircraft[0], seen_at: aircraft[0].seenAt });
  assert.equal(row.hex, 'a1');
});

test('normalizeFeedRow drops rows without title or time', () => {
  assert.equal(normalizeFeedRow({ id: 'x', pub_ms: T0 }), null);
  assert.equal(normalizeFeedRow({ id: 'x', title: 'Hi' }), null);
  assert.equal(normalizeFeedRow(feed[0] && { ...feed[0], pub_ms: feed[0].pubMs }).title, 'Structure fire');
});

test('normalizeHistoryStatus requires both counts', () => {
  assert.equal(
    normalizeHistoryStatus({ aircraftRows: 615374, feedRows: 80951, oldestMs: T0, newestMs: T0 + HOUR }).aircraftRows,
    615374,
  );
  assert.equal(normalizeHistoryStatus({ aircraftRows: 1 }), null);
  assert.equal(normalizeHistoryStatus(null), null);
});

test('normalizeHistoryWindow keeps only valid rows', () => {
  const window = normalizeHistoryWindow(
    { count: 3, fromMs: T0, untilMs: T0 + HOUR, rows: [{ hex: 'a1', lat: 39, lon: -74.9, seen_at: T0 }, { hex: 'bad' }, null] },
    normalizeAircraftRow,
  );
  assert.equal(window.rows.length, 1);
  assert.equal(window.fromMs, T0);
  assert.equal(normalizeHistoryWindow({ rows: 'nope' }, normalizeAircraftRow), null);
});

test('positionsAt shows the latest position at or before the cursor', () => {
  // At T0+15m: a1 is at its second (T0+10m) position; a2 has not appeared yet.
  const at15 = positionsAt(aircraft, T0 + 15 * 60_000);
  assert.equal(at15.length, 1);
  assert.equal(at15[0].seenAt, T0 + 10 * 60_000);
  // At T0+30m both aircraft show, a1 still at its T0+10m position.
  const at30 = positionsAt(aircraft, T0 + 30 * 60_000);
  assert.equal(at30.length, 2);
  assert.equal(at30[0].hex, 'a1');
  assert.equal(at30[0].seenAt, T0 + 10 * 60_000);
  // Before the first row: nothing — the replay never invents a position.
  assert.deepEqual(positionsAt(aircraft, T0 - 1), []);
});

test('feedAt shows only the 15 minutes before the cursor', () => {
  assert.deepEqual(feedAt(feed, T0 + 10 * 60_000).map((r) => r.id), ['f1']);
  assert.deepEqual(feedAt(feed, T0 + 30 * 60_000).map((r) => r.id), ['f2']);
  assert.deepEqual(feedAt(feed, T0 + 60 * 60_000), []);
});

test('timeBuckets keeps empty buckets and counts rows per bucket', () => {
  const buckets = timeBuckets(aircraft, feed, T0, T0 + HOUR);
  assert.equal(buckets.length, 4);
  assert.deepEqual(
    buckets.map((b) => [b.aircraft, b.feed]),
    [
      [2, 1],
      [0, 1],
      [1, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(timeBuckets(aircraft, feed, T0, T0), []);
});

test('formatReplayTime is a short local time', () => {
  assert.match(formatReplayTime(T0), /^\d{1,2}:\d{2}\s?[AP]M$/);
  assert.equal(formatReplayTime(null), null);
});
