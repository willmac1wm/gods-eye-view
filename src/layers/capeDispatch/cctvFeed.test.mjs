import assert from 'node:assert/strict';
import test from 'node:test';
import { capeCctvSources, capeFeed, mergeCapeCctvSources } from './cctvFeed.js';
import { CAPE_PUBLIC_WEBCAMS } from './publicWebcams.js';

const payloads = {
  traffic: {
    cameras: [
      {
        id: 'mt',
        name: 'Middle Thorofare Bridge (Two Mile Landing)',
        lat: 38.961,
        lng: -74.872,
        road: 'Ocean Drive Toll Bridge',
        source: 'Cape May County Bridge Commission',
        heading: 45,
        fov: 60,
        heading_confidence: 'high',
        player_url: 'https://capemaydispatch.com/map',
        extra: { city: 'Wildwood Crest / Cape May' },
      },
      {
        name: 'Cape May Ferry: Toll Booth',
        lat: 38.968,
        lng: -74.96,
        source: 'Cape May-Lewes Ferry (DRBA)',
        stream_url:
          'https://5b18e54927a82.streamlock.net/live/CapeMayTollBooth.stream/playlist.m3u8',
        image_url: 'https://cdn.jwplayer.com/thumbs/QugvJVYD-720.jpg',
        player_url: 'https://www.capemaydispatch.com/map',
        heading: 270,
        fov: 65,
        heading_confidence: 'high',
      },
      {
        name: 'DE 24 @ BEACON MIDDLE SCHOOL',
        lat: 38.714,
        lng: -75.151,
        source: 'DelDOT TMC',
        image_url:
          'https://video.deldot.gov:443/live/SCAM196.stream/playlist.m3u8',
      },
    ],
  },
  fx: {
    cameras: [
      {
        id: 'harbor',
        name: 'Harbor',
        lat: 38.95,
        lng: -74.9,
        thumb: '/api/fx/cam/harbor.jpg',
      },
    ],
  },
};

test('Cape cameras become CCTV sources and skip the old site as a feed', () => {
  const sources = capeCctvSources(payloads, 'https://capemaydispatch.com');
  assert.equal(sources.length, 4);
  const bridge = sources[0];
  assert.equal(bridge.id, 'cape-traffic-mt');
  assert.equal(bridge.feedType, 'image');
  assert.equal(bridge.url, '');
  assert.equal(bridge.snapshotUrl, '');
  assert.equal(bridge.headingDeg, 45);
  assert.equal(bridge.fovDeg, 60);
  assert.equal(bridge.city, 'Wildwood Crest / Cape May');
  assert.equal(bridge.provider, 'Cape May County Bridge Commission');
  assert.equal(bridge.sourceKind, 'cape-dispatch');
  assert.doesNotMatch(JSON.stringify(bridge), /capemaydispatch\.com/);

  const ferry = sources[1];
  assert.equal(ferry.id, 'cape-traffic-capemaytollbooth');
  assert.equal(ferry.feedType, 'hls');
  assert.equal(
    ferry.url,
    'https://5b18e54927a82.streamlock.net/live/CapeMayTollBooth.stream/playlist.m3u8',
  );
  assert.equal(
    ferry.snapshotUrl,
    'https://cdn.jwplayer.com/thumbs/QugvJVYD-720.jpg',
  );

  const deldot = sources[2];
  assert.equal(deldot.feedType, 'hls');
  assert.equal(
    deldot.url,
    'https://video.deldot.gov/live/SCAM196.stream/playlist.m3u8',
  );
  assert.equal(deldot.snapshotUrl, '');

  const harbor = sources[3];
  assert.equal(harbor.feedType, 'image');
  assert.equal(
    harbor.snapshotUrl,
    'https://capemaydispatch.com/api/fx/cam/harbor.jpg',
  );
  assert.equal(harbor.url, harbor.snapshotUrl);
});

test('a relative fx still stays same-origin without an operator base', () => {
  const feed = capeFeed({ thumb: '/api/fx/cam/harbor.jpg' });
  assert.equal(feed.hasFeed, true);
  assert.equal(feed.snapshotUrl, '/api/cape/fx/cam/harbor.jpg');
});

test('Fire Wire operator base absolutizes fx stills for the frame proxy', () => {
  const feed = capeFeed(
    { thumb: '/api/fx/cam/harbor.jpg' },
    'https://firewire.example',
  );
  assert.equal(
    feed.snapshotUrl,
    'https://firewire.example/api/fx/cam/harbor.jpg',
  );
});

test('public ferry webcams become HLS CCTV sources for the right-hand panel', () => {
  const sources = capeCctvSources({ webcams: CAPE_PUBLIC_WEBCAMS });
  assert.equal(sources.length, CAPE_PUBLIC_WEBCAMS.cameras.length);
  const dock = sources.find(
    (source) => source.id === 'cape-webcam-cmlf-cm-green',
  );
  assert.ok(dock);
  assert.equal(dock.feedType, 'hls');
  assert.match(dock.url, /CapeMayGreenNEW\.stream\/playlist\.m3u8$/);
  assert.equal(dock.sourceKind, 'cape-dispatch');
  assert.equal(dock.provider, 'Cape May-Lewes Ferry (DRBA)');
});

test('mergeCapeCctvSources keeps existing ids and appends ferry seed', () => {
  const primary = capeCctvSources({
    webcams: {
      cameras: [
        {
          id: 'cmlf_cm_green',
          title: 'Cape May Ferry: Bay & Dock Cam',
          lat: 38.9687,
          lng: -74.9597,
          stream_url:
            'https://5b18e54927a82.streamlock.net/live/CapeMayGreenNEW.stream/playlist.m3u8',
          source: 'Cape May-Lewes Ferry (DRBA)',
        },
      ],
    },
  });
  const ferry = capeCctvSources({ webcams: CAPE_PUBLIC_WEBCAMS });
  const merged = mergeCapeCctvSources(primary, ferry);
  assert.equal(
    merged.filter((source) => source.id === 'cape-webcam-cmlf-cm-green').length,
    1,
  );
  assert.ok(merged.length > primary.length);
});
