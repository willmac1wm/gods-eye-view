import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTY_CENTROIDS,
  gaugeAccent,
  inCapeRegion,
  lonLat,
  mapAirports,
  mapBuoys,
  mapCad,
  mapCameras,
  mapFloodGauges,
  mapNws,
  mapOutages,
  mapRadio,
  mapTfrs,
  mapTomTom,
  mapWebcams,
  mapWind,
  outerRings,
} from './model.js';

test('Cape region keeps NJ, DE, PA, and NY and drops Austin', () => {
  assert.equal(inCapeRegion(-74.91, 38.94), true);
  assert.equal(inCapeRegion(-75.5, 39.15), true);
  assert.equal(inCapeRegion(-79.99, 40.44), true);
  assert.equal(inCapeRegion(-73.76, 42.65), true);
  assert.equal(inCapeRegion(-71.86, 41.07), true);
  assert.equal(inCapeRegion(-74.01, 40.71), true);
  assert.equal(inCapeRegion(-71.06, 42.36), false);
  assert.equal(inCapeRegion(-81.7, 41.5), false);
  assert.equal(lonLat({ lat: 30.27, lng: -97.74 }), null);
});

test('flood gauges become clickable points with a flood color', () => {
  assert.equal(gaugeAccent('no_flooding'), '#00bfff');
  assert.equal(gaugeAccent('minor'), '#ffff00');
  assert.equal(gaugeAccent('major'), '#ff0000');
  const records = mapFloodGauges({
    gauges: [
      {
        id: 'g1',
        name: 'Cape May Harbor',
        lat: 38.95,
        lng: -74.89,
        observed: { category: 'minor', value: 2.1, unit: 'ft', time: '12:00' },
        forecast: { value: 3, time: '18:00' },
      },
      { id: 'far', name: 'Austin', lat: 30.27, lng: -97.74 },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Cape May Harbor');
  assert.equal(records[0].kind, 'point');
  assert.match(records[0].details.join(' '), /minor/);
});

test('cameras dedupe a shared location and keep 511 and Cape feeds', () => {
  const records = mapCameras({
    traffic: {
      cameras: [{ id: 't', name: 'GSP', lat: 39.1, lng: -74.7, road: 'GSP' }],
    },
    nj511: {
      cameras: [{ id: 'n', name: '511', lat: 39.1, lon: -74.7 }],
    },
    fx: {
      cameras: [
        {
          id: 'fx',
          name: 'Harbor',
          lat: 38.95,
          lng: -74.9,
          thumb: '/api/fx/cam/harbor.jpg',
        },
      ],
    },
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].details[0], 'Traffic camera');
  assert.match(
    records[1].details.join(' '),
    /\/api\/cape\/fx\/cam\/harbor.jpg/,
  );
});

test('webcams, wind, buoys, and METARs stay inside the region', () => {
  assert.equal(
    mapWebcams({ cameras: [{ title: 'Boardwalk', lat: 38.93, lng: -74.92 }] })
      .length,
    1,
  );
  assert.equal(
    mapWind({
      stations: [{ id: 'CM', name: 'Cape', lat: 38.94, lon: -74.9, mph: 12 }],
    })[0].details[0],
    '12 mph',
  );
  const buoy = mapBuoys({
    stations: {
      a: {
        station: '44009',
        name: 'Delaware Bay',
        lat: 38.46,
        lon: -74.7,
        wave_height_m: 1.2,
      },
    },
  });
  assert.equal(buoy[0].id, 'buoy:44009');
  const metar = mapAirports({
    airports: {
      KWWD: {
        icao: 'KWWD',
        name: 'Cape May',
        lat: 39.0,
        lon: -74.91,
        flight_category: 'VFR',
        color: '#22c55e',
      },
    },
  });
  assert.equal(metar[0].title, 'KWWD VFR');
  assert.equal(metar[0].accent, '#22c55e');
});

test('TomTom lines are lon/lat and incidents without a local point are dropped', () => {
  const records = mapTomTom({
    incidents: [
      {
        id: 'i1',
        category: 'Jam',
        from: 'GSP',
        to: 'Exit 6',
        lat: 39.05,
        lng: -74.75,
        magnitude_of_delay: 3,
        delay_s: 90,
        line: [
          [39.05, -74.76],
          [39.06, -74.74],
        ],
      },
      {
        id: 'austin',
        category: 'Jam',
        lat: 30.27,
        lng: -97.74,
        line: [
          [30.27, -97.74],
          [30.28, -97.73],
        ],
      },
    ],
  });
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, 'polyline');
  assert.deepEqual(records[0].positions[0], [-74.76, 39.05]);
  assert.equal(records[1].kind, 'point');
  assert.equal(records[1].accent, '#ff0000');
});

test('NWS polygons and feed points, outages, CAD, and local TFRs', () => {
  const ring = [
    [-75.0, 39.0],
    [-74.7, 39.0],
    [-74.7, 39.2],
    [-75.0, 39.0],
  ];
  const nws = mapNws(
    {
      nws_alerts: [
        {
          id: 'a',
          event: 'Coastal Flood Warning',
          geometry: { type: 'Polygon', coordinates: [ring] },
          headline: 'Flooding',
        },
      ],
    },
    {
      nws: [
        {
          id: 'f',
          title: 'Rip current',
          lat: 38.94,
          lon: -74.9,
          source_label: 'NWS',
        },
      ],
    },
  );
  assert.equal(nws.length, 2);
  assert.equal(nws[0].kind, 'polygon');
  assert.equal(outerRings({ type: 'Polygon', coordinates: [ring] }).length, 1);

  const outages = mapOutages({
    counties: {
      'Cape May': { out: 40, served: 100, etr: '18:00' },
      Austin: { out: 9 },
    },
    towns: [{ county: 'Cape May', town: 'Wildwood', out: 10 }],
  });
  assert.equal(outages.length, 1);
  assert.equal(outages[0].kind, 'ellipse');
  assert.deepEqual(
    [outages[0].lon, outages[0].lat],
    COUNTY_CENTROIDS['Cape May'],
  );

  const cad = mapCad({
    incidents: {
      incidents: [
        { id: '1', type: 'Fire', lat: 38.95, lng: -74.9, status: 'open' },
      ],
    },
    units: {
      units: [{ id: 'E1', lat: 38.96, lng: -74.91, status: 'enroute' }],
    },
    calls: {
      calls: [
        {
          id: 'c',
          type: 'Medical',
          lat: 38.94,
          lng: -74.92,
          priority: 'high',
          location: 'Beach Ave',
        },
      ],
    },
  });
  assert.equal(cad.length, 3);
  assert.equal(
    cad.find((record) => record.id.startsWith('call:')).accent,
    '#ff00ff',
  );

  const tfrs = mapTfrs({
    features: [
      {
        id: 'local',
        properties: { notam: '6/1234', type: 'Security' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
      {
        id: 'west',
        properties: { notam: '9/9999' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-122, 37],
              [-121, 37],
              [-121, 38],
              [-122, 37],
            ],
          ],
        },
      },
    ],
  });
  assert.equal(tfrs.length, 1);
  assert.match(tfrs[0].title, /6\/1234/);
});

test('dispatch radio lists feeds on one Cape May anchor', () => {
  const radio = mapRadio({
    feeds: [
      { name: 'County Fire', agency: 'CMC', live: true },
      { name: 'Coast Guard', agency: 'USCG', live: false },
    ],
  });
  assert.equal(radio.count, 2);
  assert.equal(radio.live, 1);
  assert.equal(radio.records.length, 1);
  assert.match(radio.records[0].details[0], /LIVE County Fire/);
  assert.equal(radio.records[0].lon, COUNTY_CENTROIDS['Cape May'][0]);
});
