import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chunkIsLive,
  mapSnapshotFeeds,
  RADIO_FEEDS,
  snapshotTimestampToEpoch,
} from './firewireRadio.js';

const NOW = 1794830400; // 2026-11-16T12:00:00Z

// Run fn with the process time zone switched (Node re-reads TZ on assignment),
// so the zone bug is caught even on a UTC CI runner.
function inTimeZone(tz, fn) {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
}

const ZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Pacific/Kiritimati',
];

test('chunkIsLive honours the 180 s window with a small clock-skew allowance', () => {
  assert.equal(chunkIsLive(NOW - 30, NOW), true);
  assert.equal(chunkIsLive(NOW - 180, NOW), true);
  assert.equal(chunkIsLive(NOW - 181, NOW), false);
  assert.equal(chunkIsLive(NOW + 60, NOW), true);
  assert.equal(chunkIsLive(NOW + 121, NOW), false);
  assert.equal(chunkIsLive(null, NOW), false);
});

test('mapSnapshotFeeds merges snapshot liveness onto the curated table', () => {
  const feeds = mapSnapshotFeeds(
    {
      audio_feeds: [
        {
          source_id: 3,
          feed_id: 37982,
          name: 'Cape May County Public Safety (Broadcastify feed 37982)',
          last_chunk_at: '2026-11-16T11:59:00.000000',
          age_seconds: 60,
        },
        {
          source_id: 17,
          feed_id: 17999,
          name: 'Middle Township Volunteer Fire',
          last_chunk_at: '2026-10-10T18:45:04.529993',
          age_seconds: 3173911,
        },
      ],
    },
    NOW,
  );
  assert.equal(feeds.length, RADIO_FEEDS.length);
  assert.equal(feeds.length, 8);
  const primary = feeds.find((f) => f.feed_id === 37982);
  assert.equal(primary.live, true);
  assert.equal(primary.has_audio, true);
  assert.equal(primary.last_heard_at, '2026-11-16T11:59:00.000000');
  assert.equal(primary.is_primary, true);
  assert.equal(primary.agency, 'County Dispatch');
  const middle = feeds.find((f) => f.feed_id === 17999);
  assert.equal(middle.live, false);
  assert.equal(middle.has_audio, true);
  const silent = feeds.find((f) => f.feed_id === 22200);
  assert.equal(silent.live, false);
  assert.equal(silent.has_audio, false);
  assert.equal(silent.last_heard_at, null);
});

test('snapshotTimestampToEpoch reads Fire Wire zoneless isoformat() as UTC', () => {
  for (const tz of ZONES) {
    inTimeZone(tz, () => {
      // Python datetime.utcnow().isoformat(), with and without microseconds.
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T11:59:00.000000'),
        NOW - 60,
        tz,
      );
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T11:59:00.529993'),
        NOW - 60,
        tz,
      );
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T11:59:00'),
        NOW - 60,
        tz,
      );
      // Raw SQLite DateTime text uses a space separator.
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16 11:59:00.000000'),
        NOW - 60,
        tz,
      );
      // An explicit zone is honoured, not overridden.
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T11:59:00Z'),
        NOW - 60,
        tz,
      );
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T11:59:00.000+00:00'),
        NOW - 60,
        tz,
      );
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T06:59:00-05:00'),
        NOW - 60,
        tz,
      );
      assert.equal(
        snapshotTimestampToEpoch('2026-11-16T17:29:00+0530'),
        NOW - 60,
        tz,
      );
    });
  }
});

test('snapshotTimestampToEpoch rejects what is not a timestamp', () => {
  assert.equal(snapshotTimestampToEpoch(null), null);
  assert.equal(snapshotTimestampToEpoch(''), null);
  assert.equal(snapshotTimestampToEpoch('not a date'), null);
  assert.equal(snapshotTimestampToEpoch('2026-13-01T00:00:00'), null);
  assert.equal(snapshotTimestampToEpoch('2026-02-31T00:00:00'), null);
  assert.equal(snapshotTimestampToEpoch('2026-11-16T24:00:00'), null);
});

test('mapSnapshotFeeds liveness does not depend on the server time zone', () => {
  const snapshot = {
    audio_feeds: [
      { feed_id: 37982, last_chunk_at: '2026-11-16T11:59:00.000000' },
      { feed_id: 18044, last_chunk_at: '2026-11-16T11:56:59' },
      { feed_id: 13481, last_chunk_at: '2026-11-16T12:01:30.250000' },
    ],
  };
  for (const tz of ZONES) {
    inTimeZone(tz, () => {
      const feeds = mapSnapshotFeeds(snapshot, NOW);
      const live = (id) => feeds.find((f) => f.feed_id === id).live;
      assert.equal(live(37982), true, `60 s old chunk live in ${tz}`);
      assert.equal(live(18044), false, `181 s old chunk stale in ${tz}`);
      assert.equal(live(13481), true, `90 s skew still live in ${tz}`);
    });
  }
});

test('mapSnapshotFeeds tolerates a missing snapshot', () => {
  const feeds = mapSnapshotFeeds(null, NOW);
  assert.equal(feeds.length, 8);
  assert.equal(
    feeds.every((f) => f.live === false),
    true,
  );
});
