import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSatnogsSnapshot,
  normalizeSatnogsObservation,
  satnogsObservationUrl,
  SATNOGS_TRAILING_MS,
  SATNOGS_SCHEDULED_MS,
} from './records.js';

// Fixed "now": Mon 2026-11-16 06:30:00 UTC — the morning the allowlist
// was re-discovered live. Fixture rows use the real shape of the
// observations API (verified live 2026-11-16), incl. the CPSAT
// observation 15449441 heard by W2MMD (station 223).
const NOW = Date.parse('2026-11-16T06:30:00Z');

function observation(overrides = {}) {
  return {
    id: 15449441,
    start: '2026-11-16T05:12:41Z',
    end: '2026-11-16T05:22:03Z',
    ground_station: 223,
    norad_cat_id: 98194,
    satellite_name: 'CPSAT',
    status: 'good',
    vetted_status: null,
    waterfall:
      'https://s3.eu-central-1.wasabisys.com/satnogs-network/data_obs/2026/11/16/5/15449441/waterfall_15449441_2026-11-16T05-12-41.png',
    payload:
      'https://network-satnogs.freetls.fastly.net/media/data_obs/2026/11/16/5/15449441/satnogs_15449441_2026-11-16T05-12-41.ogg',
    demod_count: 21,
    transmitter_description: 'Mode U - BPSK9k6 - AX.25 G3RUH',
    transmitter_mode: 'BPSK',
    transmitter_downlink_low: 437265000,
    transmitter_downlink_high: 437265000,
    observation_frequency: 437265000,
    max_altitude: 29,
    rise_azimuth: 196,
    set_azimuth: 331,
    station_name: 'W2MMD GCARC Clubhouse',
    station_lat: 39.716,
    station_lng: -75.21,
    ...overrides,
  };
}

test('windows are a trailing week completed and 48 h scheduled', () => {
  assert.equal(SATNOGS_TRAILING_MS, 7 * 24 * 60 * 60_000);
  assert.equal(SATNOGS_SCHEDULED_MS, 48 * 60 * 60_000);
});

test('observation URLs point at the public SatNOGS page', () => {
  assert.equal(
    satnogsObservationUrl(15449441),
    'https://network.satnogs.org/observations/15449441/',
  );
  assert.equal(satnogsObservationUrl('bogus'), null);
  assert.equal(satnogsObservationUrl(0), null);
});

test('a good observation normalizes with its media links', () => {
  const row = normalizeSatnogsObservation(observation(), { now: NOW });
  assert.equal(row.stableId, 'satnogs:15449441');
  assert.equal(row.id, 15449441);
  assert.equal(row.satelliteName, 'CPSAT');
  assert.equal(row.noradCatId, 98194);
  assert.equal(row.stationId, 223);
  assert.equal(row.stationName, 'W2MMD GCARC Clubhouse');
  assert.equal(row.lat, 39.716);
  assert.equal(row.lon, -75.21);
  assert.equal(row.status, 'good');
  assert.equal(row.startMs, Date.parse('2026-11-16T05:12:41Z'));
  assert.equal(row.endMs, Date.parse('2026-11-16T05:22:03Z'));
  assert.match(row.waterfallUrl, /waterfall_15449441.*\.png$/);
  assert.match(row.audioUrl, /satnogs_15449441.*\.ogg$/);
  assert.equal(
    row.observationUrl,
    'https://network.satnogs.org/observations/15449441/',
  );
  assert.equal(row.demodCount, 21);
  assert.equal(row.transmitterMode, 'BPSK');
  assert.equal(row.downlinkHz, 437265000);
  assert.equal(row.maxAltitude, 29);
  assert.equal(row.riseAzimuth, 196);
  assert.equal(row.setAzimuth, 331);
});

test('an unnamed satellite falls back to its NORAD id', () => {
  const row = normalizeSatnogsObservation(
    observation({ satellite_name: null }),
    { now: NOW },
  );
  assert.equal(row.satelliteName, 'NORAD 98194');
  const unknown = normalizeSatnogsObservation(
    observation({ satellite_name: '  ', norad_cat_id: null }),
    { now: NOW },
  );
  assert.equal(unknown.satelliteName, 'Unknown satellite');
});

test('only http(s) media URLs survive; non-https is dropped', () => {
  const row = normalizeSatnogsObservation(
    observation({
      waterfall: 'http://example.com/w.png',
      payload: 'not a url',
    }),
    { now: NOW },
  );
  assert.equal(row.waterfallUrl, null);
  assert.equal(row.audioUrl, null);
});

test('defensive re-filtering: status and timestamps must agree', () => {
  // A "good" row whose end is still in the future is not completed —
  // the upstream good list has leaked future rows.
  assert.equal(
    normalizeSatnogsObservation(
      observation({
        start: '2026-11-16T06:00:00Z',
        end: '2026-11-16T07:00:00Z',
      }),
      { now: NOW },
    ),
    null,
  );
  // A "future" row that already started is not scheduled.
  assert.equal(
    normalizeSatnogsObservation(
      observation({
        status: 'future',
        start: '2026-11-16T06:00:00Z',
        end: '2026-11-16T06:10:00Z',
      }),
      { now: NOW },
    ),
    null,
  );
  // Non-good/non-future statuses (bad, failed, unvetted) never count.
  for (const status of ['bad', 'failed', 'unvetted', 'unknown']) {
    assert.equal(
      normalizeSatnogsObservation(observation({ status }), { now: NOW }),
      null,
      status,
    );
  }
});

test('window edges: 7 days back and 48 h forward', () => {
  // Exactly at the trailing edge is in; one minute past it is out.
  const edge = new Date(NOW - SATNOGS_TRAILING_MS).toISOString();
  assert.notEqual(
    normalizeSatnogsObservation(
      observation({ start: edge, end: new Date(NOW - SATNOGS_TRAILING_MS + 600_000).toISOString() }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeSatnogsObservation(
      observation({
        start: new Date(NOW - SATNOGS_TRAILING_MS - 60_000).toISOString(),
        end: new Date(NOW - SATNOGS_TRAILING_MS - 30_000).toISOString(),
      }),
      { now: NOW },
    ),
    null,
  );
  // A future row exactly 48 h out is in; one minute past it is out.
  const far = new Date(NOW + SATNOGS_SCHEDULED_MS).toISOString();
  assert.notEqual(
    normalizeSatnogsObservation(
      observation({
        status: 'future',
        start: far,
        end: new Date(NOW + SATNOGS_SCHEDULED_MS + 600_000).toISOString(),
      }),
      { now: NOW },
    ),
    null,
  );
  assert.equal(
    normalizeSatnogsObservation(
      observation({
        status: 'future',
        start: new Date(NOW + SATNOGS_SCHEDULED_MS + 60_000).toISOString(),
        end: new Date(NOW + SATNOGS_SCHEDULED_MS + 120_000).toISOString(),
      }),
      { now: NOW },
    ),
    null,
  );
});

test('off-allowlist stations and malformed rows are dropped', () => {
  // GS3 (941) is the nearest station overall but Offline — excluded.
  assert.equal(
    normalizeSatnogsObservation(observation({ ground_station: 941 }), {
      now: NOW,
    }),
    null,
  );
  assert.equal(normalizeSatnogsObservation(null, { now: NOW }), null);
  assert.equal(normalizeSatnogsObservation({}, { now: NOW }), null);
  assert.equal(
    normalizeSatnogsObservation(observation({ id: 'bogus' }), { now: NOW }),
    null,
  );
  assert.equal(
    normalizeSatnogsObservation(observation({ start: 'never' }), {
      now: NOW,
    }),
    null,
  );
  // End before start is nonsense.
  assert.equal(
    normalizeSatnogsObservation(
      observation({
        start: '2026-11-16T05:22:03Z',
        end: '2026-11-16T05:12:41Z',
      }),
      { now: NOW },
    ),
    null,
  );
});

test('snapshot keeps completed + scheduled, dedupes, and pins every station', () => {
  const snapshot = normalizeSatnogsSnapshot(
    {
      stations: [],
      observations: [
        observation(),
        // Same observation twice: newest start wins, counted once.
        observation(),
        observation({
          id: 15449442,
          norad_cat_id: 62394,
          satellite_name: null,
          start: '2026-11-16T04:00:00Z',
          end: '2026-11-16T04:10:00Z',
        }),
        observation({
          id: 15458254,
          status: 'future',
          norad_cat_id: 98914,
          satellite_name: 'ISS',
          start: '2026-11-17T16:56:41Z',
          end: '2026-11-17T17:06:41Z',
        }),
        // Dropped: bad status, off-allowlist, out-of-window.
        observation({ id: 1, status: 'bad' }),
        observation({ id: 2, ground_station: 941 }),
        observation({
          id: 3,
          start: '2026-11-01T00:00:00Z',
          end: '2026-11-01T00:10:00Z',
        }),
      ],
    },
    { now: NOW },
  );
  assert.equal(snapshot.totalObservations, 3);
  assert.equal(snapshot.completedCount, 2);
  assert.equal(snapshot.scheduledCount, 1);
  assert.equal(snapshot.stationCount, 4);
  // Newest start first.
  assert.deepEqual(
    snapshot.rows.map((row) => row.id),
    [15458254, 15449441, 15449442],
  );
  assert.equal(snapshot.rows[2].satelliteName, 'NORAD 62394');
  // Every allowlisted station is listed, even with zero observations —
  // a quiet ear is still an ear.
  assert.deepEqual(
    snapshot.stations.map((station) => station.id),
    [223, 2575, 4655, 3610],
  );
  const anchor = snapshot.stations[0];
  assert.equal(anchor.name, 'W2MMD GCARC Clubhouse');
  assert.equal(anchor.completedCount, 2);
  assert.equal(anchor.scheduledCount, 1);
  assert.equal(
    anchor.latestStartMs,
    Date.parse('2026-11-17T16:56:41Z'),
  );
  for (const station of snapshot.stations.slice(1)) {
    assert.equal(station.completedCount, 0);
    assert.equal(station.scheduledCount, 0);
    assert.equal(station.latestStartMs, null);
  }
});

test('malformed snapshots are null, never partial', () => {
  assert.equal(normalizeSatnogsSnapshot(null, { now: NOW }), null);
  assert.equal(normalizeSatnogsSnapshot([], { now: NOW }), null);
  assert.equal(normalizeSatnogsSnapshot({}, { now: NOW }), null);
  assert.equal(
    normalizeSatnogsSnapshot({ observations: 'nope' }, { now: NOW }),
    null,
  );
  assert.deepEqual(normalizeSatnogsSnapshot({ observations: [] }, { now: NOW }), {
    rows: [],
    stations: [
      {
        id: 223,
        name: 'W2MMD GCARC Clubhouse',
        lat: 39.716,
        lon: -75.21,
        distanceKm: 84,
        observations: 64276,
        successRate: 67,
        completedCount: 0,
        scheduledCount: 0,
        latestStartMs: null,
      },
      {
        id: 2575,
        name: 'KC3QNJ',
        lat: 38.308,
        lon: -76.474,
        distanceKm: 157,
        observations: 2521,
        successRate: 68,
        completedCount: 0,
        scheduledCount: 0,
        latestStartMs: null,
      },
      {
        id: 4655,
        name: 'Alx2',
        lat: 38.78407,
        lon: -77.11324,
        distanceKm: 193,
        observations: 13689,
        successRate: 65,
        completedCount: 0,
        scheduledCount: 0,
        latestStartMs: null,
      },
      {
        id: 3610,
        name: 'ka6akh-ground-station',
        lat: 38.8246,
        lon: -77.14037,
        distanceKm: 195,
        observations: 7101,
        successRate: 79,
        completedCount: 0,
        scheduledCount: 0,
        latestStartMs: null,
      },
    ],
    completedCount: 0,
    scheduledCount: 0,
    totalObservations: 0,
    stationCount: 4,
  });
});
