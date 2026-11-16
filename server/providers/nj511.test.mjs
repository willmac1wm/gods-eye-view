import assert from 'node:assert/strict';
import test from 'node:test';
import { mapNj511Event, mapNj511Camera } from './nj511.js';

test('mapNj511Event maps the assumed Iteris row shape', () => {
  const mapped = mapNj511Event({
    ID: 'EV-1',
    EventType: 'Accident',
    Description: 'Crash on the Garden State Parkway',
    RoadwayName: 'Garden State Parkway',
    Latitude: 39.08,
    Longitude: -74.82,
    LastUpdated: '2026-11-16T12:00:00Z',
  });
  assert.equal(mapped.id, 'EV-1');
  assert.equal(mapped.event_type, 'Accident');
  assert.equal(mapped.road, 'Garden State Parkway');
  assert.equal(mapped.lat, 39.08);
  assert.equal(mapped.last_updated, '2026-11-16T12:00:00Z');
  assert.equal(mapNj511Event({ ID: 'x' }), null);
  assert.equal(mapNj511Event({ Latitude: 39.08 }), null);
});

test('mapNj511Event tolerates the lowercase field variants', () => {
  const mapped = mapNj511Event({
    id: 7,
    Type: 'Road Work',
    latitude: 39.0,
    longitude: -74.9,
  });
  assert.equal(mapped.id, 7);
  assert.equal(mapped.event_type, 'Road Work');
});

test('mapNj511Camera maps the assumed GetCameras row shape', () => {
  const mapped = mapNj511Camera({
    ID: 'CAM-9',
    CameraName: 'GSP MP 25',
    ImageUrl: 'https://example.com/cam9.jpg',
    RoadwayName: 'Garden State Parkway',
    Latitude: 39.1,
    Longitude: -74.8,
  });
  assert.equal(mapped.name, 'GSP MP 25');
  assert.equal(mapped.image_url, 'https://example.com/cam9.jpg');
  assert.equal(mapped.source, '511NJ');
  assert.equal(mapNj511Camera({ Latitude: 39.1 }), null);
});
