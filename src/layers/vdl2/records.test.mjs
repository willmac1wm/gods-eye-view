import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categorizeVdl2Text,
  isLocalVdl2Message,
  isUndecodedFrame,
  isVdl2Message,
  normalizeVdl2Snapshot,
  selectVdl2Rows,
  vdl2MessageRow,
  VDL2_STATION_ID,
} from './records.js';

const T0 = Date.parse('2026-11-16T07:39:25Z');

function message(overrides = {}) {
  return {
    id: 8135359152,
    sourceType: 'vdl',
    source: 'dumpvdl2',
    mode: '2',
    label: 'H1',
    text: '0,00000,00000,00000,-7.75,-5.69,0.117,0.152,',
    tail: 'N219BZ',
    fromHex: 'A12345',
    frequency: 136.65,
    latitude: null,
    longitude: null,
    altitude: null,
    createdAt: '2026-11-16T07:39:25.625Z',
    timestamp: '2026-11-16T07:39:25.623Z',
    data: null,
    station: {
      id: VDL2_STATION_ID,
      ident: 'PhillyRox-VDLM',
      nearestAirportIcao: 'KPHL',
      flagged: true,
      flaggedReason: 'Rate anomaly detected',
    },
    flight: {
      flight: 'MX501',
      departingAirport: 'MMMX',
      destinationAirport: 'KPHL',
      latitude: 39.5,
      longitude: -74.9,
    },
    airframe: { tail: 'N219BZ' },
    ...overrides,
  };
}

test('isVdl2Message discriminates on sourceType, not mode or label', () => {
  assert.equal(isVdl2Message(message()), true);
  assert.equal(isVdl2Message({ ...message(), source: 'vdlm2dec' }), true);
  assert.equal(isVdl2Message({ ...message(), sourceType: 'acars' }), false);
  assert.equal(isVdl2Message({ ...message(), sourceType: 'hfdl' }), false);
  // mode '2' and label 'H1' also occur on ACARS — they prove nothing.
  assert.equal(
    isVdl2Message({ ...message(), sourceType: 'acars', mode: '2', label: 'H1' }),
    false,
  );
  assert.equal(isVdl2Message(null), false);
  assert.equal(isVdl2Message({}), false);
});

test('isUndecodedFrame needs label, text, and data all null', () => {
  assert.equal(
    isUndecodedFrame({ ...message(), label: null, text: null, data: null }),
    true,
  );
  assert.equal(
    isUndecodedFrame({ ...message(), label: null, text: null, data: 'x' }),
    false,
  );
  assert.equal(isUndecodedFrame(message()), false);
});

test('categorizeVdl2Text matches the watcher categories in order', () => {
  assert.deepEqual(categorizeVdl2Text('MAYDAY MAYDAY'), {
    category: 'mayday',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('PAN-PAN PAN-PAN'), {
    category: 'pan-pan',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('ENGINE FAIL'), {
    category: 'engine failure',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('SMOKE IN CABIN'), {
    category: 'smoke on board',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('FIRE ON BOARD'), {
    category: 'fire on board',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('DEPRESSURISATION'), {
    category: 'depressurisation',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('DIVERTING TO PHL'), {
    category: 'diversion',
    severity: 'high',
  });
  assert.deepEqual(categorizeVdl2Text('MEDICAL EMERGENCY ON BOARD'), {
    category: 'emergency',
    severity: 'critical',
  });
  assert.equal(categorizeVdl2Text('POSITION REPORT 39000FT'), null);
  assert.equal(categorizeVdl2Text(''), null);
  assert.equal(categorizeVdl2Text(null), null);
});

test('categorizeVdl2Text collapses line breaks and applies the exclusions', () => {
  // ACARS/VDL2 text uses CR/LF breaks: a phrase can split across lines.
  assert.deepEqual(categorizeVdl2Text('EMERGENCY\r\nAIRCRAFT ON GROUND'), null);
  assert.equal(
    categorizeVdl2Text('DANGEROUS GOODS EMERGENCY PROCEDURES'),
    null,
  );
  assert.equal(
    categorizeVdl2Text('ENGINE FAILURE ACCEL HT 1500'),
    null,
  );
  assert.equal(categorizeVdl2Text('SMOKE DETECTOR FAULT'), null);
  assert.equal(categorizeVdl2Text('NO SMOKE ON BOARD'), null);
  // "SMOKE LAVATORY SMOKE" still alerts — only a NO SMOKE report is quiet.
  assert.deepEqual(categorizeVdl2Text('SMOKE LAVATORY SMOKE'), {
    category: 'smoke on board',
    severity: 'critical',
  });
});

test('ground stop is critical only when nationwide', () => {
  assert.deepEqual(categorizeVdl2Text('GROUND STOP NATIONWIDE'), {
    category: 'ground stop',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('GROUND STOP ALL AIRPORTS'), {
    category: 'ground stop',
    severity: 'critical',
  });
  assert.deepEqual(categorizeVdl2Text('GROUND STOP PHL'), {
    category: 'ground stop',
    severity: 'high',
  });
});

test('isLocalVdl2Message accepts the feeder, the airports, and the box', () => {
  assert.equal(isLocalVdl2Message(message()), true); // station KPHL
  const byText = message({
    station: { ident: 'OTHER', nearestAirportIcao: 'KJFK' },
    flight: { flight: 'BA1', departingAirport: 'EGLL', destinationAirport: 'KJFK', latitude: null, longitude: null },
    text: 'DIVERTING TO PHILADELPHIA',
  });
  assert.equal(isLocalVdl2Message(byText), true);
  const byBox = message({
    station: { ident: 'OTHER', nearestAirportIcao: 'KJFK' },
    flight: { flight: 'BA1', departingAirport: 'EGLL', destinationAirport: 'KJFK', latitude: 39.0, longitude: -75.0 },
    text: 'POSITION REPORT',
  });
  assert.equal(isLocalVdl2Message(byBox), true);
  const farAway = message({
    station: { ident: 'OTHER', nearestAirportIcao: 'KJFK' },
    flight: { flight: 'BA1', departingAirport: 'EGLL', destinationAirport: 'KJFK', latitude: 51.5, longitude: -0.1 },
    text: 'POSITION REPORT',
  });
  assert.equal(isLocalVdl2Message(farAway), false);
});

test('vdl2MessageRow keeps nationwide emergencies and local incidents, drops the rest', () => {
  const maydayLocal = vdl2MessageRow({
    ...message(),
    text: 'MAYDAY MAYDAY FUEL',
  });
  assert.equal(maydayLocal.category, 'mayday');
  assert.equal(maydayLocal.severity, 'critical');
  assert.equal(maydayLocal.flight, 'MX501');
  assert.equal(maydayLocal.tail, 'N219BZ');
  assert.equal(maydayLocal.fromHex, 'A12345');
  assert.equal(maydayLocal.stationIdent, 'PhillyRox-VDLM');
  assert.equal(maydayLocal.stationAirport, 'KPHL');
  assert.equal(maydayLocal.timeMs, Date.parse('2026-11-16T07:39:25.625Z'));
  assert.equal(
    maydayLocal.url,
    'https://api.airframes.io/v1/messages/8135359152',
  );
  // The guardrail: the row never carries the raw text.
  assert.equal('text' in maydayLocal, false);

  // Nationwide emergency with no local signal at all is still kept.
  const maydayFar = vdl2MessageRow({
    ...message(),
    id: 1,
    text: 'MAYDAY MAYDAY',
    station: { ident: 'FAR', nearestAirportIcao: 'KLAX' },
    flight: { flight: 'AA1', departingAirport: 'KLAX', destinationAirport: 'KJFK', latitude: 34.0, longitude: -118.0 },
  });
  assert.equal(maydayFar.category, 'mayday');
  assert.equal(maydayFar.hasPosition, false);

  // A diversion over California is not Cape Dispatch's business.
  assert.equal(
    vdl2MessageRow({
      ...message(),
      id: 2,
      text: 'DIVERTING TO KLAX',
      station: { ident: 'FAR', nearestAirportIcao: 'KLAX' },
      flight: { flight: 'AA1', departingAirport: 'KJFK', destinationAirport: 'KLAX', latitude: 34.0, longitude: -118.0 },
    }),
    null,
  );
  // Routine decodable traffic is counted upstream, not listed.
  assert.equal(vdl2MessageRow(message()), null);
  // ACARS on the same endpoint is not VDL2.
  assert.equal(
    vdl2MessageRow({ ...message(), sourceType: 'acars', text: 'MAYDAY' }),
    null,
  );
});

test('vdl2MessageRow counts local undecoded frames and drops remote ones', () => {
  const local = vdl2MessageRow({
    ...message(),
    label: null,
    text: null,
    data: null,
  });
  assert.equal(local.category, 'undecoded');
  assert.equal(local.severity, 'info');
  assert.equal(local.undecoded, true);
  assert.equal(local.flight, 'MX501');
  const remote = vdl2MessageRow({
    ...message(),
    id: 9,
    label: null,
    text: null,
    data: null,
    station: { ident: 'FAR', nearestAirportIcao: 'KLAX' },
    flight: { flight: 'AA1', departingAirport: 'KLAX', destinationAirport: 'KJFK', latitude: 34.0, longitude: -118.0 },
  });
  assert.equal(remote, null);
});

test('a stale flight fix outside the box is not a position', () => {
  // Verified live 2026-11-16: a PhillyRox message whose flight fix was
  // 41.06, −104.46 (Colorado). A VHF message heard in Philadelphia
  // cannot come from an aircraft over Colorado — the fix is stale.
  const row = vdl2MessageRow({
    ...message(),
    text: 'MAYDAY MAYDAY',
    flight: {
      flight: 'MX501',
      departingAirport: 'MMMX',
      destinationAirport: 'KPHL',
      latitude: 41.059307,
      longitude: -104.455199,
    },
  });
  assert.equal(row.category, 'mayday');
  assert.equal(row.hasPosition, false);
  assert.equal(row.lat, null);
  assert.equal(row.lon, null);

  const local = vdl2MessageRow({ ...message(), text: 'MAYDAY MAYDAY' });
  assert.equal(local.hasPosition, true);
  assert.equal(local.lat, 39.5);
  assert.equal(local.lon, -74.9);
});

test('selectVdl2Rows dedupes by id and sorts newest first', () => {
  const rows = selectVdl2Rows([
    message({ id: 3, text: 'MAYDAY', createdAt: '2026-11-16T07:30:00Z' }),
    message({ id: 3, text: 'MAYDAY', createdAt: '2026-11-16T07:30:00Z' }),
    message({
      id: 4,
      text: 'DIVERTING TO PHL',
      createdAt: '2026-11-16T07:35:00Z',
    }),
    message({ id: 5, text: 'POSITION REPORT' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['4', '3'],
  );
  assert.equal(selectVdl2Rows(null).length, 0);
  assert.equal(selectVdl2Rows('nope').length, 0);
});

test('normalizeVdl2Snapshot validates rows, drops smuggled text, and recounts', () => {
  const snapshot = normalizeVdl2Snapshot({
    fetchedAt: T0,
    stale: false,
    heardLocal: 100,
    heardTruncated: true,
    stationFlagged: true,
    stationFlagReason: 'Rate anomaly detected',
    rows: [
      {
        id: '3',
        stableId: 'vdl2:3',
        flight: 'MX501',
        tail: 'N219BZ',
        fromHex: 'A12345',
        label: 'H1',
        mode: '2',
        frequency: 136.65,
        stationIdent: 'PhillyRox-VDLM',
        stationAirport: 'KPHL',
        category: 'mayday',
        severity: 'critical',
        undecoded: false,
        hasPosition: true,
        lat: 39.5,
        lon: -74.9,
        timeMs: T0,
        url: 'https://api.airframes.io/v1/messages/3',
        text: 'MAYDAY — must never survive',
      },
      {
        id: '4',
        category: 'undecoded',
        severity: 'info',
        undecoded: true,
        hasPosition: false,
        lat: null,
        lon: null,
        timeMs: T0 - 1000,
      },
      { id: '5', category: 'not-a-category', severity: 'high' },
      { id: '3', category: 'mayday', severity: 'critical' },
    ],
  });
  assert.equal(snapshot.rows.length, 2);
  assert.equal('text' in snapshot.rows[0], false);
  assert.equal(snapshot.rows[0].stationIdent, 'PhillyRox-VDLM');
  assert.deepEqual(snapshot.counts.mayday, 1);
  assert.deepEqual(snapshot.counts.undecoded, 1);
  assert.equal(snapshot.categorizedCount, 1);
  assert.equal(snapshot.undecodedCount, 1);
  assert.equal(snapshot.heardLocal, 100);
  assert.equal(snapshot.heardTruncated, true);
  assert.equal(snapshot.stationFlagged, true);
  assert.equal(snapshot.stationFlagReason, 'Rate anomaly detected');
  assert.equal(snapshot.fetchedAt, T0);
  assert.equal(snapshot.stale, false);
  assert.equal(normalizeVdl2Snapshot(null), null);
  assert.equal(normalizeVdl2Snapshot({ rows: 'nope' }), null);
  assert.equal(normalizeVdl2Snapshot({ rows: [] }).heardLocal, null);
});
