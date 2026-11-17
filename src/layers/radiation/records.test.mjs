import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceKm,
  normalizeSafecastMeasurement,
  parseRadnetCsv,
  parseRadnetTime,
  validateRadiationSnapshot,
} from './records.js';
import { COUNTY_SEAT } from './policy.js';

// Live RadNet CDX CSV rows, 2026-11-16 (first + last rows of the Edison file).
const EDISON_CSV =
  'LOCATION_NAME,SAMPLE COLLECTION TIME,DOSE EQUIVALENT RATE (nSv/h),' +
  'GAMMA COUNT RATE R02 (CPM),GAMMA COUNT RATE R03 (CPM),GAMMA COUNT RATE R04 (CPM),' +
  'GAMMA COUNT RATE R05 (CPM),GAMMA COUNT RATE R06 (CPM),GAMMA COUNT RATE R07 (CPM),' +
  'GAMMA COUNT RATE R08 (CPM),GAMMA COUNT RATE R09 (CPM),STATUS\n' +
  'NJ: EDISON,01/01/2026 00:32:00,40.00,1480.00,781.00,233.00,119.00,81.00,101.00,55.00,28.00,APPROVED\n' +
  'NJ: EDISON,11/16/2026 20:42:00,37.00,1344.00,732.00,223.00,118.00,78.00,92.00,57.00,29.00,APPROVED\n' +
  'NJ: EDISON,11/16/2026 21:42:00,39.00,1348.00,732.00,220.00,116.00,77.00,92.00,61.00,28.00,APPROVED\n';

test('parseRadnetCsv takes the last APPROVED row (live Edison values)', () => {
  const row = parseRadnetCsv(EDISON_CSV);
  assert.equal(row.locationName, 'NJ: EDISON');
  assert.equal(row.doseRateNSvH, 39);
  assert.equal(row.gammaCpmR02, 1348);
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.sampleTime, '2026-11-16T21:42:00.000Z');
});

test('parseRadnetCsv skips non-APPROVED rows and returns null when none qualify', () => {
  const pending = EDISON_CSV.replaceAll(',APPROVED', ',PENDING');
  assert.equal(parseRadnetCsv(pending), null);
  assert.equal(parseRadnetCsv(''), null);
  assert.equal(parseRadnetCsv('LOCATION_NAME,STATUS\nNJ: EDISON,APPROVED\n'), null);
});

test('parseRadnetTime converts the UTC sample time to ISO', () => {
  assert.equal(parseRadnetTime('11/16/2026 21:42:00'), '2026-11-16T21:42:00.000Z');
  assert.equal(parseRadnetTime('01/01/2026 00:32:00'), '2026-01-01T00:32:00.000Z');
  assert.equal(parseRadnetTime('not a date'), null);
  assert.equal(parseRadnetTime(null), null);
});

test('distanceKm puts Philadelphia nearer than Edison', () => {
  const philly = distanceKm(COUNTY_SEAT, { lat: 39.9526, lon: -75.1652 });
  const edison = distanceKm(COUNTY_SEAT, { lat: 40.5187, lon: -74.4121 });
  assert.ok(philly > 90 && philly < 115, `philly ${philly}`);
  assert.ok(edison > 150 && edison < 175, `edison ${edison}`);
  assert.ok(philly < edison);
  assert.equal(distanceKm(null, { lat: 1, lon: 1 }), null);
});

test('normalizeSafecastMeasurement keeps a live-style row', () => {
  const row = normalizeSafecastMeasurement({
    id: 86772796,
    value: 26.0,
    unit: 'cpm',
    latitude: 38.808321666666664,
    longitude: -76.97334833333333,
    captured_at: '2017-06-06T20:22:57.000Z',
  });
  assert.equal(row.value, 26);
  assert.equal(row.unit, 'cpm');
  assert.equal(row.capturedAt, '2017-06-06T20:22:57.000Z');
  assert.equal(normalizeSafecastMeasurement({ value: 'x' }), null);
  assert.equal(normalizeSafecastMeasurement(null), null);
});

test('validateRadiationSnapshot requires a monitor and tolerates a null Safecast half', () => {
  const snapshot = {
    fetchedAt: 1,
    stale: false,
    monitors: [
      {
        key: 'edison',
        name: 'Edison',
        state: 'NJ',
        doseRateNSvH: 39,
        gammaCpmR02: 1348,
        sampleTime: '2026-11-16T21:42:00.000Z',
      },
    ],
    safecast: null,
  };
  assert.equal(validateRadiationSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateRadiationSnapshot({ ...snapshot, monitors: [] }),
    /invalid snapshot/,
  );
  assert.throws(
    () =>
      validateRadiationSnapshot({
        ...snapshot,
        monitors: [{ key: 'edison', doseRateNSvH: 'high' }],
      }),
    /invalid snapshot/,
  );
});
