import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTY_CENTROIDS,
  gaugeAccent,
  inCapeRegion,
  isCapeSourceFresh,
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
        link: 'https://water.noaa.gov/gauges/cmhn4',
        observed: { category: 'minor', value: 2.1, unit: 'ft', time: '12:00' },
        forecast: { value: 3, time: '18:00' },
      },
      { id: 'far', name: 'Austin', lat: 30.27, lng: -97.74 },
    ],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].title, 'Cape May Harbor');
  assert.equal(records[0].kind, 'point');
  assert.equal(records[0].linkUrl, 'https://water.noaa.gov/gauges/cmhn4');
  assert.match(records[0].details.join(' '), /minor/);
});

test('cameras dedupe a shared location and keep 511 and Cape feeds', () => {
  const records = mapCameras({
    traffic: {
      cameras: [
        {
          id: 't',
          name: 'GSP',
          lat: 39.1,
          lng: -74.7,
          road: 'GSP',
          image_url: 'https://cams.example/gsp.jpg',
          player_url: 'https://cams.example/gsp/live',
        },
      ],
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
  assert.equal(records[0].id, 'cape-traffic-t');
  assert.equal(records[0].cctvId, 'cape-traffic-t');
  assert.equal(records[0].imageUrl, '');
  assert.equal(records[0].linkUrl, '');
  assert.equal(records[1].id, 'cape-fx-fx');
  assert.equal(records[1].cctvId, 'cape-fx-fx');
  assert.doesNotMatch(records[1].details.join(' '), /No public feed/);
});

test('bridge cameras do not use the old dispatch site as a feed', () => {
  const records = mapCameras({
    traffic: {
      cameras: [
        {
          id: 'mt',
          name: 'Middle Thorofare Bridge (Two Mile Landing)',
          lat: 38.961,
          lng: -74.872,
          road: 'Ocean Drive Toll Bridge',
          source: 'Cape May County Bridge Commission',
          image_url: null,
          stream_url: null,
          player_url: 'https://capemaydispatch.com/map',
        },
        {
          id: 'ferry',
          name: 'Cape May Ferry: Toll Booth',
          lat: 38.968,
          lng: -74.96,
          stream_url:
            'https://5b18e54927a82.streamlock.net/live/CapeMayTollBooth.stream/playlist.m3u8',
          image_url: 'https://cdn.jwplayer.com/thumbs/QugvJVYD-720.jpg',
          player_url: 'https://www.capemaydispatch.com/map',
        },
        {
          id: 'deldot',
          name: 'DE 24 @ BEACON MIDDLE SCHOOL',
          lat: 38.714,
          lng: -75.151,
          image_url:
            'https://video.deldot.gov:443/live/SCAM196.stream/playlist.m3u8',
        },
      ],
    },
  });
  assert.equal(records.length, 3);
  assert.equal(records[0].cctvId, 'cape-traffic-mt');
  assert.match(records[0].details.join(' '), /No public feed/);
  assert.doesNotMatch(records[0].details.join(' '), /capemaydispatch\.com/);
  assert.equal(records[1].cctvId, 'cape-traffic-ferry');
  assert.doesNotMatch(records[1].details.join(' '), /capemaydispatch\.com/);
  assert.equal(records[2].cctvId, 'cape-traffic-deldot');
  assert.equal(records[0].imageUrl, '');
  assert.equal(records[1].linkUrl, '');
  assert.equal(records[2].linkUrl, '');
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
        pressure_hpa: 1015.4,
      },
    },
  });
  assert.equal(buoy[0].id, 'buoy:44009');
  assert.match(buoy[0].details.join(' '), /1015\.4 hPa/);
  const metar = mapAirports({
    airports: {
      KWWD: {
        icao: 'KWWD',
        name: 'Cape May',
        lat: 39.0,
        lon: -74.91,
        flight_category: 'VFR',
        color: '#22c55e',
        raw: 'KWWD 041955Z AUTO 18008KT 10SM CLR 18/11 A3002',
        taf_raw: 'TAF KWWD 041730Z 0418/0518 19010KT P6SM FEW050',
      },
    },
  });
  assert.equal(metar[0].title, 'KWWD VFR');
  assert.equal(metar[0].accent, '#22c55e');
  assert.match(metar[0].details.join(' '), /TAF: TAF KWWD/);
});

test('health gating respects down and stale sources and fails open when absent', () => {
  assert.equal(isCapeSourceFresh(null, 'flood'), true);
  assert.equal(isCapeSourceFresh({}, 'flood'), true);
  assert.equal(
    isCapeSourceFresh(
      { flood: { key: 'flood', state: 'ok', age_s: 120 } },
      'flood',
    ),
    true,
  );
  assert.equal(
    isCapeSourceFresh(
      { flood: { key: 'flood', state: 'down', age_s: 10 } },
      'flood',
    ),
    false,
  );
  assert.equal(
    isCapeSourceFresh(
      { flood: { key: 'flood', state: 'ok', age_s: 950 } },
      'flood',
    ),
    false,
  );
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
          audio_url: '/fw-audio/clip.mp3',
          feed_id: 37982,
        },
      ],
    },
  });
  assert.equal(cad.length, 3);
  const call = cad.find((record) => record.id.startsWith('call:'));
  assert.equal(call.accent, '#ff00ff');
  assert.equal(call.audioUrl, '/api/cape/fw-audio/clip.mp3');
  assert.equal(call.feedId, '37982');

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

test('dispatch radio places one pin per scanner feed around Cape May', () => {
  const radio = mapRadio({
    feeds: [
      {
        feed_id: 37982,
        name: 'County Fire',
        agency: 'CMC',
        live: true,
        has_audio: true,
        is_primary: true,
      },
      {
        feed_id: 17999,
        name: 'Coast Guard',
        agency: 'USCG',
        live: false,
        has_audio: true,
      },
    ],
  });
  assert.equal(radio.count, 2);
  assert.equal(radio.live, 1);
  assert.equal(radio.records.length, 2);
  assert.equal(radio.records[0].title, 'County Fire');
  assert.equal(radio.records[0].feedId, '37982');
  assert.equal(radio.records[0].details[0], 'LIVE');
  assert.equal(radio.records[1].details[0], 'idle · waiting on SDR');
  assert.equal(radio.quiet, false);
  assert.equal(mapRadio({ feeds: [] }).quiet, true);
  assert.notEqual(radio.records[0].lon, radio.records[1].lon);
  for (const record of radio.records) {
    assert.ok(Math.abs(record.lon - COUNTY_CENTROIDS['Cape May'][0]) < 0.05);
    assert.ok(Math.abs(record.lat - COUNTY_CENTROIDS['Cape May'][1]) < 0.05);
  }
});
