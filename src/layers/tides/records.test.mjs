import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeWaterLevelPayload,
  normalizePredictionsPayload,
  normalizeFloodLevels,
  normalizeDatums,
  buildGaugeRow,
  trendFromPoints,
  floodStageForLevel,
} from './records.js';

// Verbatim live payloads, NOAA CO-OPS, 2026-11-15 ~21:12 EST.
const ATLANTIC_CITY_LATEST = {
  metadata: {
    id: '8534720',
    name: 'Atlantic City',
    lat: '39.3567',
    lon: '-74.4181',
  },
  data: [{ t: '2026-11-15 21:12', v: '2.673', s: '0.098', f: '1,0,0,0', q: 'p' }],
};

const CAPE_MAY_RANGE = {
  metadata: { id: '8536110', name: 'Cape May', lat: '38.9683', lon: '-74.96' },
  data: [
    { t: '2026-11-15 20:00', v: '1.864' },
    { t: '2026-11-15 21:00', v: '2.405' },
    { t: '2026-11-15 21:12', v: '2.536', s: '0.049', f: '0,0,0,0', q: 'p' },
  ],
};

const CAPE_MAY_PREDICTIONS = {
  predictions: [
    { t: '2026-11-15 20:00', v: '1.251' },
    { t: '2026-11-15 21:00', v: '1.816' },
    { t: '2026-11-15 21:12', v: '1.949' },
  ],
};

const CAPE_MAY_PREDICTIONS_HILO = {
  predictions: [
    { t: '2026-11-15 05:44', v: '0.978', type: 'L' },
    { t: '2026-11-15 12:14', v: '4.919', type: 'H' },
    { t: '2026-11-15 18:39', v: '0.892', type: 'L' },
    { t: '2026-11-16 00:45', v: '3.841', type: 'H' },
  ],
};

// MDAPI floodlevels, feet above station datum (verified 2026-11-15).
const CAPE_MAY_FLOODLEVELS = {
  nos_minor: 9.72,
  nos_moderate: 10.66,
  nos_major: 11.92,
  nws_minor: 9.12,
  nws_moderate: 10.12,
  nws_major: 11.12,
  action: null,
};
const ATLANTIC_CITY_FLOODLEVELS = {
  nos_minor: 11.38,
  nos_moderate: 12.32,
  nos_major: 13.58,
  nws_minor: 10.96,
  nws_moderate: 11.96,
  nws_major: 12.96,
  action: null,
};

// MDAPI datums.json shape: {units: "feet", datums: [{name, value}, ...]}.
const CAPE_MAY_DATUMS = {
  units: 'feet',
  datums: [
    { name: 'MHHW', value: 7.87 },
    { name: 'MHW', value: 7.43 },
    { name: 'MSL', value: 4.99 },
    { name: 'MLLW', value: 2.42 },
    { name: 'NAVD88', value: 5.44 },
    { name: 'HAT', value: 9.124 },
  ],
};

const CAPE_MAY_NWS = { minor: 6.7, moderate: 7.7, major: 8.7 };
const GAUGE = { id: '8536110', name: 'Cape May', lat: 38.9683, lon: -74.96 };

test('normalizeWaterLevelPayload parses the live latest payload and keeps point order', () => {
  const parsed = normalizeWaterLevelPayload(ATLANTIC_CITY_LATEST);
  assert.deepEqual(parsed, {
    stationId: '8534720',
    name: 'Atlantic City',
    lat: 39.3567,
    lon: -74.4181,
    points: [{ t: '2026-11-15 21:12', v: 2.673, sigma: 0.098, quality: 'p' }],
  });
  const range = normalizeWaterLevelPayload(CAPE_MAY_RANGE);
  assert.equal(range.points.length, 3);
  assert.deepEqual(
    range.points.map((p) => p.v),
    [1.864, 2.405, 2.536],
  );
  assert.equal(range.points[2].sigma, 0.049);
  assert.equal(range.points[2].quality, 'p');
});

test('normalizeWaterLevelPayload rejects missing metadata, data, or an empty series', () => {
  for (const payload of [
    null,
    undefined,
    [],
    'nope',
    {},
    { data: [] },
    { metadata: ATLANTIC_CITY_LATEST.metadata },
    { metadata: ATLANTIC_CITY_LATEST.metadata, data: [] },
    { metadata: ATLANTIC_CITY_LATEST.metadata, data: 'not-an-array' },
    { metadata: {}, data: ATLANTIC_CITY_LATEST.data },
    {
      metadata: { ...ATLANTIC_CITY_LATEST.metadata, id: '' },
      data: ATLANTIC_CITY_LATEST.data,
    },
    {
      metadata: { ...ATLANTIC_CITY_LATEST.metadata, name: 42 },
      data: ATLANTIC_CITY_LATEST.data,
    },
  ])
    assert.equal(normalizeWaterLevelPayload(payload), null, JSON.stringify(payload));
});

test('normalizeWaterLevelPayload rejects bad values and error payloads', () => {
  const base = ATLANTIC_CITY_LATEST;
  const withPoint = (point) => ({
    metadata: base.metadata,
    data: [point],
  });
  for (const point of [
    { t: '2026-11-15 21:12', v: 'abc' },
    { t: '2026-11-15 21:12', v: '' },
    { t: '2026-11-15 21:12' },
    { t: '2026-11-15', v: '2.673' },
    { t: '15 Nov 2026 21:12', v: '2.673' },
    { t: '2026-11-15 21:12', v: Number.NaN },
    null,
    'nope',
  ])
    assert.equal(normalizeWaterLevelPayload(withPoint(point)), null, JSON.stringify(point));
  for (const metadata of [
    { ...base.metadata, lat: '91' },
    { ...base.metadata, lat: '-91' },
    { ...base.metadata, lon: '181' },
    { ...base.metadata, lat: 'abc' },
    { ...base.metadata, lon: undefined },
  ])
    assert.equal(
      normalizeWaterLevelPayload({ metadata, data: base.data }),
      null,
      JSON.stringify(metadata),
    );
  assert.equal(
    normalizeWaterLevelPayload({
      error: { message: 'There is no MLLW for the station: 9999999' },
    }),
    null,
  );
});

test('normalizeWaterLevelPayload tolerates missing optional fields', () => {
  const parsed = normalizeWaterLevelPayload({
    metadata: ATLANTIC_CITY_LATEST.metadata,
    data: [{ t: '2026-11-15 21:12', v: '2.673' }],
  });
  assert.deepEqual(parsed.points, [
    { t: '2026-11-15 21:12', v: 2.673, sigma: null, quality: null },
  ]);
  const nonStringQ = normalizeWaterLevelPayload({
    metadata: ATLANTIC_CITY_LATEST.metadata,
    data: [{ t: '2026-11-15 21:12', v: '2.673', q: 7 }],
  });
  assert.equal(nonStringQ.points[0].quality, null);
});

test('normalizePredictionsPayload parses hilo and 6-minute series', () => {
  assert.deepEqual(
    normalizePredictionsPayload(CAPE_MAY_PREDICTIONS_HILO).map((p) => p.v),
    [0.978, 4.919, 0.892, 3.841],
  );
  assert.deepEqual(normalizePredictionsPayload(CAPE_MAY_PREDICTIONS), [
    { t: '2026-11-15 20:00', v: 1.251 },
    { t: '2026-11-15 21:00', v: 1.816 },
    { t: '2026-11-15 21:12', v: 1.949 },
  ]);
  for (const payload of [
    null,
    {},
    { predictions: [] },
    { predictions: 'nope' },
    { predictions: [{ t: '2026-11-15 21:12', v: 'abc' }] },
    { predictions: [{ t: '2026-11-15', v: '1.0' }] },
    { error: { message: 'bad datum' } },
  ])
    assert.equal(normalizePredictionsPayload(payload), null, JSON.stringify(payload));
});

test('normalizeFloodLevels parses both stations and rejects bad thresholds', () => {
  assert.deepEqual(normalizeFloodLevels(CAPE_MAY_FLOODLEVELS), {
    nos: { minor: 9.72, moderate: 10.66, major: 11.92 },
    nws: { minor: 9.12, moderate: 10.12, major: 11.12 },
  });
  assert.deepEqual(normalizeFloodLevels(ATLANTIC_CITY_FLOODLEVELS), {
    nos: { minor: 11.38, moderate: 12.32, major: 13.58 },
    nws: { minor: 10.96, moderate: 11.96, major: 12.96 },
  });
  // `action` is null at both stations and is not part of the classification.
  assert.notEqual(normalizeFloodLevels({ ...CAPE_MAY_FLOODLEVELS, action: 3.5 }), null);
  for (const key of [
    'nos_minor',
    'nos_moderate',
    'nos_major',
    'nws_minor',
    'nws_moderate',
    'nws_major',
  ]) {
    assert.equal(
      normalizeFloodLevels({ ...CAPE_MAY_FLOODLEVELS, [key]: undefined }),
      null,
      key,
    );
    assert.equal(
      normalizeFloodLevels({ ...CAPE_MAY_FLOODLEVELS, [key]: 'abc' }),
      null,
      key,
    );
  }
  assert.equal(
    normalizeFloodLevels({ ...CAPE_MAY_FLOODLEVELS, nws_minor: 10.12 }),
    null,
    'non-monotonic NWS thresholds are rejected',
  );
  assert.equal(normalizeFloodLevels(null), null);
});

test('normalizeDatums returns the MLLW offset and rejects metric payloads', () => {
  assert.deepEqual(normalizeDatums(CAPE_MAY_DATUMS), { mllwOffsetFt: 2.42 });
  assert.equal(normalizeDatums({ ...CAPE_MAY_DATUMS, units: 'metric' }), null);
  assert.equal(normalizeDatums({ units: 'feet', datums: [] }), null);
  assert.equal(
    normalizeDatums({
      units: 'feet',
      datums: [{ name: 'MHHW', value: 7.87 }],
    }),
    null,
  );
  assert.equal(
    normalizeDatums({
      units: 'feet',
      datums: [{ name: 'MLLW', value: 'abc' }],
    }),
    null,
  );
  assert.equal(normalizeDatums({ datums: CAPE_MAY_DATUMS.datums }), null);
});

test('buildGaugeRow matches observed to predicted on the verbatim timestamp', () => {
  const row = buildGaugeRow({
    gauge: GAUGE,
    observed: normalizeWaterLevelPayload(CAPE_MAY_RANGE),
    predictions: normalizePredictionsPayload(CAPE_MAY_PREDICTIONS),
    thresholds: {
      nws: CAPE_MAY_NWS,
      nos: { minor: 7.3, moderate: 8.24, major: 9.5 },
    },
  });
  assert.deepEqual(row, {
    stationId: '8536110',
    name: 'Cape May',
    lat: 38.9683,
    lon: -74.96,
    observedFtMllw: 2.536,
    observedTime: '2026-11-15 21:12',
    predictedFtMllw: 1.949,
    residualFt: 0.587,
    floodStage: 'none',
    trend: 'rising',
    sigmaFt: 0.049,
    quality: 'p',
    thresholdsMllw: CAPE_MAY_NWS,
    nosThresholdsMllw: { minor: 7.3, moderate: 8.24, major: 9.5 },
  });

  // No prediction for the latest timestamp: nulls, never interpolated.
  const unmatched = buildGaugeRow({
    gauge: GAUGE,
    observed: normalizeWaterLevelPayload(CAPE_MAY_RANGE),
    predictions: normalizePredictionsPayload({
      predictions: [{ t: '2026-11-15 21:00', v: '1.816' }],
    }),
    thresholds: { nws: CAPE_MAY_NWS, nos: null },
  });
  assert.equal(unmatched.predictedFtMllw, null);
  assert.equal(unmatched.residualFt, null);
  assert.equal(unmatched.observedFtMllw, 2.536);

  // Unknown thresholds: stage none, threshold fields null, row still stands.
  const unknown = buildGaugeRow({
    gauge: GAUGE,
    observed: normalizeWaterLevelPayload(CAPE_MAY_RANGE),
    predictions: normalizePredictionsPayload(CAPE_MAY_PREDICTIONS),
    thresholds: null,
  });
  assert.equal(unknown.floodStage, 'none');
  assert.equal(unknown.thresholdsMllw, null);
  assert.equal(unknown.nosThresholdsMllw, null);
});

test('buildGaugeRow reports no trend for a single-point window', () => {
  const row = buildGaugeRow({
    gauge: GAUGE,
    observed: normalizeWaterLevelPayload(ATLANTIC_CITY_LATEST),
    predictions: normalizePredictionsPayload({
      predictions: [{ t: '2026-11-15 21:12', v: '2.100' }],
    }),
    thresholds: { nws: { minor: 6, moderate: 7, major: 8 }, nos: null },
  });
  assert.equal(row.trend, null);
  assert.equal(row.residualFt, 0.573);
});

test('trendFromPoints honors the 0.02 ft dead band', () => {
  const points = (a, b) => [
    { t: '2026-11-15 21:06', v: a },
    { t: '2026-11-15 21:12', v: b },
  ];
  assert.equal(trendFromPoints(points(2.0, 2.021)), 'rising');
  assert.equal(trendFromPoints(points(2.0, 2.019)), 'steady');
  assert.equal(trendFromPoints(points(2.0, 1.979)), 'falling');
  assert.equal(trendFromPoints(points(2.0, 1.981)), 'steady');
  assert.equal(trendFromPoints(points(2.0, 2.0)), 'steady');
  assert.equal(trendFromPoints([{ t: '2026-11-15 21:12', v: 2.0 }]), null);
  assert.equal(trendFromPoints([]), null);
  assert.equal(trendFromPoints(null), null);
});

test('floodStageForLevel classifies inclusively at the NWS boundaries', () => {
  const cases = [
    [6.69, 'none'],
    [6.7, 'minor'],
    [7.69, 'minor'],
    [7.7, 'moderate'],
    [8.69, 'moderate'],
    [8.7, 'major'],
    [12.0, 'major'],
    [0, 'none'],
  ];
  for (const [level, stage] of cases)
    assert.equal(floodStageForLevel(level, CAPE_MAY_NWS), stage, String(level));
  assert.equal(floodStageForLevel(null, CAPE_MAY_NWS), 'none');
  assert.equal(floodStageForLevel(Number.NaN, CAPE_MAY_NWS), 'none');
  assert.equal(floodStageForLevel(9.9, null), 'none');
  assert.equal(
    floodStageForLevel(9.9, { minor: 6.7, moderate: 7.7 }),
    'none',
  );
});
