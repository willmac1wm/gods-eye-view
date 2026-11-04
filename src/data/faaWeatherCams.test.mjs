import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFaaCameraRecords,
  isFaaWeatherCamImageUrl,
  mapFaaWebcamCatalog,
  mapFaaWebcamRecord,
  FAA_WEATHERCAMS_CATALOG_URL,
  FAA_WEATHERCAMS_SOURCE_KIND,
} from './faaWeatherCams.js';

test('FAA image URL pin accepts WeatherCams hosts and rejects arbitrary origins', () => {
  assert.equal(
    isFaaWeatherCamImageUrl('https://weathercams.faa.gov/images/a.jpg'),
    true,
  );
  assert.equal(
    isFaaWeatherCamImageUrl('https://images.weathercams.faa.gov/a.jpg'),
    true,
  );
  assert.equal(isFaaWeatherCamImageUrl('https://example.com/cam.jpg'), false);
  assert.equal(
    isFaaWeatherCamImageUrl('http://weathercams.faa.gov/a.jpg'),
    false,
  );
});

test('FAA catalog unwraps WorldView arrays and {payload} envelopes', () => {
  const cam = {
    id: 'site-1-n',
    description: 'PANC North',
    siteDescription: 'Anchorage Intl',
    latitude: 61.17,
    longitude: -150.0,
    imageUrl: 'https://weathercams.faa.gov/images/panc-n.jpg',
  };
  assert.equal(extractFaaCameraRecords([cam]).length, 1);
  assert.equal(
    extractFaaCameraRecords({ success: true, payload: [cam] }).length,
    1,
  );
});

test('FAA mapper emits an airport CCTV source pack record, not an intersection cam', () => {
  const mapped = mapFaaWebcamRecord(
    {
      id: 'panc-n',
      description: 'North apron',
      siteDescription: 'Anchorage Intl',
      latitude: 61.1743,
      longitude: -149.9963,
      cameraDirection: 'N',
      imageUrl: 'https://weathercams.faa.gov/images/panc-n.jpg',
    },
    (direction) => (String(direction).toUpperCase() === 'N' ? 0 : NaN),
  );
  assert.equal(mapped.sourceKind, FAA_WEATHERCAMS_SOURCE_KIND);
  assert.equal(mapped.provider, 'FAA WeatherCams');
  assert.equal(mapped.cityId, 'faa-weathercams');
  assert.equal(mapped.feedType, 'image');
  assert.equal(mapped.id, 'faa-panc-n');
  assert.equal(mapped.headingDeg, 0);
  assert.match(mapped.name, /Anchorage/);
});

test('FAA mapper drops cameras without FAA-hosted stills', () => {
  assert.equal(
    mapFaaWebcamRecord({
      id: 'x',
      latitude: 40,
      longitude: -74,
      imageUrl: 'https://evil.example/cam.jpg',
    }),
    null,
  );
  assert.equal(
    mapFaaWebcamRecord({
      id: 'x',
      latitude: 40,
      longitude: -74,
    }),
    null,
  );
});

test('FAA catalog URL is the WorldView WeatherCams endpoint', () => {
  assert.equal(
    FAA_WEATHERCAMS_CATALOG_URL,
    'https://weathercams.faa.gov/api/v1/cameras',
  );
  const catalog = mapFaaWebcamCatalog({
    payload: [
      {
        id: '1',
        latitude: 21.32,
        longitude: -157.92,
        siteDescription: 'Honolulu Intl',
        imageUrl: '/media/phnl.jpg',
      },
    ],
  });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].url, 'https://weathercams.faa.gov/media/phnl.jpg');
});
