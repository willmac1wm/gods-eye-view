import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auroraOutlook,
  kpActivityLabel,
  kpToGScale,
  normalizeAceMag,
  normalizeAceSwepam,
  normalizeKpCurrent,
  normalizeKpForecast,
  parseThreeDayForecast,
  validateSpaceWeatherSnapshot,
} from './records.js';

const THREE_DAY_TEXT = `:Product: 3-Day Forecast
:Issued: 2026 Nov 16 1230 UTC
# Prepared by the U.S. Dept. of Commerce, NOAA, Space Weather Prediction Center
#
A. NOAA Geomagnetic Activity Observation and Forecast

The greatest observed 3 hr Kp over the past 24 hours was 1 (below NOAA
Scale levels).
The greatest expected 3 hr Kp for Nov 16-Nov 18 2026 is 4.67 (NOAA Scale
G1).
`;

test('kpToGScale maps the NOAA G-scale thresholds', () => {
  assert.equal(kpToGScale(0), null);
  assert.equal(kpToGScale(4.67), null);
  assert.equal(kpToGScale(5), 'G1');
  assert.equal(kpToGScale(6), 'G2');
  assert.equal(kpToGScale(7), 'G3');
  assert.equal(kpToGScale(8), 'G4');
  assert.equal(kpToGScale(9), 'G5');
  assert.equal(kpToGScale(null), null);
});

test('kpActivityLabel names each band', () => {
  assert.equal(kpActivityLabel(0), 'quiet');
  assert.equal(kpActivityLabel(4), 'unsettled');
  assert.equal(kpActivityLabel(5), 'minor storm');
  assert.equal(kpActivityLabel(7), 'strong storm');
  assert.equal(kpActivityLabel(9), 'extreme storm');
});

test('auroraOutlook is honest about 39 degrees north', () => {
  assert.equal(auroraOutlook(0), 'No aurora this far south.');
  assert.equal(auroraOutlook(4.67), 'No aurora this far south.');
  assert.match(auroraOutlook(5), /no aurora this far south/);
  assert.match(auroraOutlook(7), /may reach the northern Mid-Atlantic/);
  assert.match(auroraOutlook(8), /possible over Cape May/);
});

test('normalizeKpCurrent takes the last 1-minute row (live: Kp 0)', () => {
  const current = normalizeKpCurrent([
    { time_tag: '2026-11-16T22:26:00', kp_index: 0, estimated_kp: 0.33, kp: '0P' },
    { time_tag: '2026-11-16T22:27:00', kp_index: 0, estimated_kp: 0.0, kp: '0Z' },
  ]);
  assert.equal(current.kp, 0);
  assert.equal(current.gScale, null);
  assert.equal(current.activity, 'quiet');
  assert.equal(current.timeTag, '2026-11-16T22:27:00');
  assert.equal(normalizeKpCurrent([]), null);
  assert.equal(normalizeKpCurrent([{ time_tag: 'x' }]), null);
});

test('normalizeKpForecast finds the predicted maximum (live: 4.67 G1)', () => {
  const forecast = normalizeKpForecast([
    { time_tag: '2026-11-16T00:00:00', kp: 3.0, observed: 'observed', noaa_scale: null },
    { time_tag: '2026-11-18T00:00:00', kp: 4.67, observed: 'predicted', noaa_scale: 'G1' },
    { time_tag: '2026-11-17T21:00:00', kp: 4.67, observed: 'predicted', noaa_scale: 'G1' },
  ]);
  assert.equal(forecast.maxKp, 4.67);
  assert.equal(forecast.maxScale, 'G1');
  assert.equal(forecast.entries.length, 3);
  assert.equal(normalizeKpForecast([]), null);
});

test('parseThreeDayForecast reads the live Nov 16 text', () => {
  const parsed = parseThreeDayForecast(THREE_DAY_TEXT);
  assert.equal(parsed.greatestExpectedKp, 4.67);
  assert.equal(parsed.greatestExpectedScale, 'G1');
  assert.equal(parsed.greatestObservedKp, 1);
  assert.equal(parsed.issued, '2026 Nov 16 1230 UTC');
  assert.equal(parseThreeDayForecast(''), null);
  assert.deepEqual(parseThreeDayForecast('nothing matching here'), {
    greatestExpectedKp: null,
    greatestExpectedScale: null,
    greatestObservedKp: null,
    issued: null,
  });
});

test('normalizeAceSwepam and normalizeAceMag take the last row', () => {
  const wind = normalizeAceSwepam([
    { time_tag: '2026-11-16T22:00:00', density: 5.1, speed: 410, temperature: 120000 },
    { time_tag: '2026-11-16T22:01:00', density: 5.4, speed: 418, temperature: 118000 },
  ]);
  assert.equal(wind.speed, 418);
  assert.equal(wind.density, 5.4);
  const mag = normalizeAceMag([
    { time_tag: '2026-11-16T22:00:00', bt: 6.2, bz_gsm: -1.1 },
    { time_tag: '2026-11-16T22:01:00', bt: 6.5, bz_gsm: -2.4 },
  ]);
  assert.equal(mag.bt, 6.5);
  assert.equal(mag.bzGsm, -2.4);
  assert.equal(normalizeAceSwepam([]), null);
  assert.equal(normalizeAceMag([{ time_tag: 'x' }]), null);
});

test('validateSpaceWeatherSnapshot requires Kp but tolerates missing extras', () => {
  const snapshot = {
    fetchedAt: 1,
    stale: false,
    kp: { timeTag: '2026-11-16T22:27:00', kp: 0, gScale: null, activity: 'quiet' },
    forecast: null,
    threeDay: null,
    solarWind: null,
    mag: null,
  };
  assert.equal(validateSpaceWeatherSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateSpaceWeatherSnapshot({ ...snapshot, kp: null }),
    /invalid snapshot/,
  );
});
