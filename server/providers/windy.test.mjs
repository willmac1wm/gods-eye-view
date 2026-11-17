import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWindyCameras, playerUrl } from './windy.js';

test('playerUrl prefers live, then day, then the v2 embed shape', () => {
  assert.equal(playerUrl({ live: 'https://live.example/x', day: 'https://day.example/y' }), 'https://live.example/x');
  assert.equal(playerUrl({ day: 'https://day.example/y' }), 'https://day.example/y');
  assert.equal(
    playerUrl({ live: { available: true, embed: 'https://embed.example/z' } }),
    'https://embed.example/z',
  );
  assert.equal(playerUrl({}), '');
});

test('parseWindyCameras keeps active non-traffic cams with coordinates', () => {
  const cams = parseWindyCameras({
    webcams: [
      {
        webcamId: '123',
        title: 'Cape May Beach',
        status: 'active',
        categories: [{ id: 'beach' }],
        location: { latitude: 38.93, longitude: -74.91, city: 'Cape May' },
        images: { current: { preview: 'https://img.example/p.jpg', thumbnail: 'https://img.example/t.jpg' } },
        player: { live: 'https://player.example/live' },
      },
      {
        webcamId: '124',
        title: 'Road cam',
        status: 'active',
        categories: [{ id: 'traffic' }],
        location: { latitude: 39.0, longitude: -74.9 },
        images: { current: { preview: 'https://img.example/r.jpg' } },
      },
      {
        webcamId: '125',
        title: 'Inactive cam',
        status: 'inactive',
        categories: [],
        location: { latitude: 39.0, longitude: -74.9 },
        images: { current: { preview: 'https://img.example/i.jpg' } },
      },
      {
        webcamId: '126',
        title: 'No location',
        status: 'active',
        categories: [],
        location: {},
        images: { current: { preview: 'https://img.example/n.jpg' } },
      },
    ],
  });
  assert.equal(cams.length, 1);
  assert.equal(cams[0].id, '123');
  assert.equal(cams[0].title, 'Cape May Beach');
  assert.equal(cams[0].image_url, 'https://img.example/p.jpg');
  assert.equal(cams[0].player_url, 'https://player.example/live');
  assert.equal(cams[0].city, 'Cape May');
});

test('parseWindyCameras tolerates the v2 result wrapper and empty payloads', () => {
  assert.deepEqual(parseWindyCameras(null), []);
  assert.deepEqual(parseWindyCameras({}), []);
  assert.deepEqual(parseWindyCameras({ result: { webcams: [] } }), []);
});
