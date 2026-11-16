import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkIsLive, mapSnapshotFeeds, RADIO_FEEDS } from './firewireRadio.js';

const NOW = 1794830400; // 2026-11-16T12:00:00Z

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

test('mapSnapshotFeeds tolerates a missing snapshot', () => {
  const feeds = mapSnapshotFeeds(null, NOW);
  assert.equal(feeds.length, 8);
  assert.equal(feeds.every((f) => f.live === false), true);
});
