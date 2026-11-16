import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRealtime2, ndbcStationUrl } from './ndbc.js';

const SAMPLE_44009 = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 11 16 11 50 350  5.2  6.8  1.1   6   5  340 1018.2  12.4  14.1  10.2  MM   MM    MM
2026 11 16 10 50 340  4.8  6.1  1.0   6   5  335 1018.5  12.1  14.0  10.0  MM   MM    MM
`;

const SAMPLE_CMAN4 = `#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
2026 11 16 11 54 270  7.1  9.3   MM    MM    MM  MM  1017.9  11.8   MM    MM   MM   MM    MM
`;

test('ndbcStationUrl uppercases the station id (cman4.txt 404s)', () => {
  assert.equal(
    ndbcStationUrl('cman4'),
    'https://www.ndbc.noaa.gov/data/realtime2/CMAN4.txt',
  );
  assert.equal(
    ndbcStationUrl('44009'),
    'https://www.ndbc.noaa.gov/data/realtime2/44009.txt',
  );
});

test('parseRealtime2 reads the most recent row with header-driven columns', () => {
  const parsed = parseRealtime2(SAMPLE_44009);
  assert.equal(parsed.observed_at, '2026-11-16T11:50:00.000Z');
  assert.equal(parsed.wind_dir_deg, 350);
  assert.equal(parsed.wind_speed_ms, 5.2);
  assert.equal(parsed.gust_ms, 6.8);
  assert.equal(parsed.wave_height_m, 1.1);
  assert.equal(parsed.dominant_wave_period_s, 6);
  assert.equal(parsed.pressure_hpa, 1018.2);
  assert.equal(parsed.air_temp_c, 12.4);
  assert.equal(parsed.water_temp_c, 14.1);
});

test('parseRealtime2 maps MM to null and tolerates a wave-less coastal station', () => {
  const parsed = parseRealtime2(SAMPLE_CMAN4);
  assert.equal(parsed.observed_at, '2026-11-16T11:54:00.000Z');
  assert.equal(parsed.wind_dir_deg, 270);
  assert.equal(parsed.wind_speed_ms, 7.1);
  assert.equal(parsed.wave_height_m, null);
  assert.equal(parsed.dominant_wave_period_s, null);
  assert.equal(parsed.water_temp_c, null);
  assert.equal(parsed.pressure_hpa, 1017.9);
});

test('parseRealtime2 returns null without data rows', () => {
  assert.equal(parseRealtime2(''), null);
  assert.equal(parseRealtime2('#YY MM DD hh mm WDIR\n#yr mo dy hr mn degT\n'), null);
});
