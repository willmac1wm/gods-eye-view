// src/layers/navarea/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  categorizeWarning,
  extractPositions,
  parseNavareaBulletin,
  parsePosition,
  validateNavareaSnapshot,
} from './records.js';

// Real NAVAREA IV bulletin excerpts, indexed live text 131651Z NOV 26
// (msi.nga.mil DailyMemIV.txt, crawled 2026-11-16). Fixtures are
// copied from that indexed text, not fetched at test time.
const BULLETIN = `131651Z NOV 26

NAVAREA IV 1098/26.

1. NAVAREA IV WARNINGS IN FORCE AS OF 131651Z NOV.

 ALL THE INFORCE WARNINGS ARE LISTED HERE.

 1097/2026, 1096/2026, 1095/2026, 1094/2026, 1093/2026,

 1091/2026, 1090/2026, 1089/2026, 1087/2026, 1086/2026,

 1085/2026, 1083/2026, 1081/2026, 1080/2026, 1078/2026,

 1074/2026, 1073/2026, 1069/2026.

2. THE COMPLETE TEXT OF ALL IN-FORCE NAVAREA IV
 BROADCAST WARNINGS ARE AVAILABLE ON THE NGA
 MARITIME SAFETY INFORMATION WEBSITE AT: MSI.NGA.MIL/NAVWARNINGS.

3. CANCEL NAVAREA IV 1072/26.

131431Z NOV 26

NAVAREA IV 1097/26

CARIBBEAN SEA.

ANTIGUA AND BARBUDA.

1. DERELICT VESSEL CAPSIZED AND ADRIFT
 IN 17-02.98N 061-57.65W AT 122007Z NOV.

2. CANCEL THIS MSG 161431Z NOV 26.

131421Z NOV 26

NAVAREA IV 1096/26

CARIBBEAN SEA.

SAINT LUCIA.

1. GUNNERY EXERCISES 171800Z TO 172200Z,
 181200Z TO 181600Z, 181800Z TO 182200Z NOV
 IN AREA WITHIN 12 MILES OF 14-35.00N 061-47.30W.

2. CANCEL THIS MSG 182300Z NOV 26.

131154Z NOV 26

NAVAREA IV 1094/26

CARIBBEAN SEA.

COLOMBIA.

M/V HAYA SANK IN VICINITY
 IN 10-12.85N 075-38.28W.

WIDE BERTH REQUESTED.

120859Z NOV 26

NAVAREA IV 1090/26.

NORTH ATLANTIC.

1. HAZARDOUS OPERATIONS, SPACE DEBRIS
 0100Z TO 0200Z DAILY 14 THRU 22 NOV
 IN AREA BOUND BY
 54-35.00N 038-33.00W, 54-25.00N 037-11.00W,
 48-44.00N 039-10.00W, 48-52.00N 040-28.00W.

2. CANCEL THIS MSG 220300Z NOV 26.

061947Z NOV 26

NAVAREA IV 1074/26

CARIBBEAN SEA.

VENEZUELA.

CABLE OPERATIONS IN PROGRESS
 UNTIL FURTHER NOTICE ALONG TRACKLINE JOINING
 10-40.23N 063-15.13W, 10-42.82N 063-15.05W.

WIDE BERTH REQUESTED.

101336Z NOV 26

NAVAREA IV 1083/26

NORTH ATLANTIC.

TRINIDAD AND TOBAGO.

1. UNDERWATER OPERATIONS IN PROGRESS
 UNTIL 072100Z DEC BY M/V HOS WARLAND
 ALONG TRACKLINE JOINING
  10-05.80N 060-08.20W, 10-21.91N 060-36.22W,
 10-07.32N 060-18.67W.

 500 METER BERTH REQUESTED.

2. CANCEL NAVAREA IV 1008/26.

3. CANCEL THIS MSG 072200Z DEC 26.

051725Z NOV 26

NAVAREA IV 1069/26

1. NAVAREA IV MOBILE OFFSHORE DRILLING UNITS
 POSITIONS AT 051700Z NOV: A. AGOSTO 12 19-23.0N 092-03.1W.
 B. ARGOS PLATFORM 27-10.4N 090-22.0W.
`;

function close(actual, expected, epsilon = 0.00001) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`,
  );
}

test('maritime positions parse in every bulletin format', () => {
  const a = parsePosition('17-02.98N 061-57.65W');
  close(a.lat, 17.04967);
  close(a.lon, -61.96083);
  const b = parsePosition('19-23.0N 092-03.1W');
  close(b.lat, 19.38333);
  close(b.lon, -92.05167);
  const c = parsePosition('52-00N 056-00W');
  assert.deepEqual(c, { lat: 52, lon: -56 });
  const d = parsePosition('32-52.80N 118-17.70W');
  close(d.lat, 32.88);
  close(d.lon, -118.295);
  const e = parsePosition('10-00.00S 020-00.00E');
  assert.deepEqual(e, { lat: -10, lon: 20 });
  assert.equal(parsePosition('NOT A POSITION'), null);
  assert.equal(parsePosition(''), null);
});

test('extractPositions finds every fix in a warning body', () => {
  const positions = extractPositions(
    'IN AREA BOUND BY 54-35.00N 038-33.00W, 54-25.00N 037-11.00W, 48-44.00N 039-10.00W, 48-52.00N 040-28.00W.',
  );
  assert.equal(positions.length, 4);
  close(positions[0].lat, 54.58333);
  close(positions[3].lon, -40.46667);
  assert.equal(extractPositions('NO POSITION HERE').length, 0);
});

test('category keywords read the prose, first match wins', () => {
  assert.equal(categorizeWarning('GUNNERY EXERCISES'), 'live-fire');
  assert.equal(
    categorizeWarning('HAZARDOUS OPERATIONS, ROCKET LAUNCHING'),
    'live-fire',
  );
  assert.equal(categorizeWarning('M/V HAYA SANK IN VICINITY'), 'wreck');
  assert.equal(
    categorizeWarning('DERELICT VESSEL CAPSIZED AND ADRIFT'),
    'wreck',
  );
  assert.equal(categorizeWarning('DERELICT S/V EKINOX ADRIFT'), 'wreck');
  assert.equal(categorizeWarning('CABLE OPERATIONS IN PROGRESS'), 'cable-work');
  assert.equal(categorizeWarning('LIGHT UNRELIABLE'), 'aid-to-navigation');
  assert.equal(categorizeWarning('SURVEY OPERATIONS IN PROGRESS'), 'survey');
  assert.equal(
    categorizeWarning('MOBILE OFFSHORE DRILLING UNITS'),
    'survey',
  );
  assert.equal(categorizeWarning('UNDERWATER OPERATIONS'), 'other');
});

test('the live bulletin parses to its in-force warnings', () => {
  const parsed = parseNavareaBulletin(BULLETIN);
  assert.equal(parsed.bulletinDate, '131651Z NOV');
  assert.equal(parsed.inForceCount, 18);
  assert.equal(parsed.warnings.length, 7);
  const byId = Object.fromEntries(
    parsed.warnings.map((warning) => [warning.id, warning]),
  );
  assert.equal(byId['NAVAREA IV 1097/26'].category, 'wreck');
  assert.equal(byId['NAVAREA IV 1097/26'].issuedAt, '131431Z NOV 26');
  assert.equal(
    byId['NAVAREA IV 1097/26'].area,
    'CARIBBEAN SEA. ANTIGUA AND BARBUDA.',
  );
  close(byId['NAVAREA IV 1097/26'].positions[0].lat, 17.04967);
  close(byId['NAVAREA IV 1097/26'].positions[0].lon, -61.96083);
  assert.equal(byId['NAVAREA IV 1097/26'].positionParse, true);
  assert.equal(byId['NAVAREA IV 1096/26'].category, 'live-fire');
  assert.equal(byId['NAVAREA IV 1094/26'].category, 'wreck');
  assert.equal(byId['NAVAREA IV 1090/26'].positions.length, 4);
  assert.equal(byId['NAVAREA IV 1074/26'].category, 'cable-work');
  assert.equal(byId['NAVAREA IV 1083/26'].category, 'other');
  assert.equal(byId['NAVAREA IV 1069/26'].category, 'survey');
  assert.equal(byId['NAVAREA IV 1069/26'].positions.length, 2);
  // The index block itself is metadata, never a warning.
  assert.equal(byId['NAVAREA IV 1098/26'], undefined);
});

test('compressed one-line headers open their own block', () => {
  const parsed = parseNavareaBulletin(`131651Z NOV 26

NAVAREA IV 1098/26.

1. NAVAREA IV WARNINGS IN FORCE AS OF 131651Z NOV.
 1086/2026, 1087/2026.

110709Z NOV 26

NAVAREA IV 1087/26

NORTH ATLANTIC.

CUBA.

CAYO CAIMAN GRANDE DE SANTA MARIA LIGHT
 22-41.12N 078-53.02W UNRELIABLE., 110709Z NOV 26, NAVAREA IV 1086/26., CARIBBEAN SEA., COLOMBIA.

DERELICT M/V THE BOARD ROOM AGROUND
 IN 12-12.52N 081-45.39W.
`);
  assert.equal(parsed.warnings.length, 2);
  const byId = Object.fromEntries(
    parsed.warnings.map((warning) => [warning.id, warning]),
  );
  assert.equal(byId['NAVAREA IV 1087/26'].category, 'aid-to-navigation');
  close(byId['NAVAREA IV 1087/26'].positions[0].lat, 22.68533);
  close(byId['NAVAREA IV 1087/26'].positions[0].lon, -78.88367);
  assert.equal(byId['NAVAREA IV 1086/26'].category, 'wreck');
  assert.equal(byId['NAVAREA IV 1086/26'].issuedAt, '110709Z NOV 26');
  close(byId['NAVAREA IV 1086/26'].positions[0].lat, 12.20867);
  close(byId['NAVAREA IV 1086/26'].positions[0].lon, -81.7565);
});

test('cancel lines and the in-force list drop dead warnings', () => {
  const text = `131651Z NOV 26

NAVAREA IV 1098/26.

1. NAVAREA IV WARNINGS IN FORCE AS OF 131651Z NOV.
 1097/2026, 1072/2026.

3. CANCEL NAVAREA IV 1072/26.

131431Z NOV 26

NAVAREA IV 1097/26

CARIBBEAN SEA.

1. DERELICT VESSEL ADRIFT IN 17-02.98N 061-57.65W.

131200Z NOV 26

NAVAREA IV 1072/26

CARIBBEAN SEA.

1. OLD WARNING TEXT.

131100Z NOV 26

NAVAREA IV 1050/26

CARIBBEAN SEA.

1. NOT IN THE IN-FORCE LIST.
`;
  const parsed = parseNavareaBulletin(text);
  assert.deepEqual(
    parsed.warnings.map((warning) => warning.id),
    ['NAVAREA IV 1097/26'],
  );
});

test('a warning with no parseable position still lists', () => {
  const parsed = parseNavareaBulletin(`131200Z NOV 26

NAVAREA IV 1050/26

CARIBBEAN SEA.

1. GENERAL NOTICE WITH NO POSITION.
`);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].positionParse, false);
  assert.deepEqual(parsed.warnings[0].positions, []);
});

test('snapshot validation keeps good warnings and drops bad rows', () => {
  const snapshot = validateNavareaSnapshot({
    fetchedAt: 1,
    stale: false,
    bulletinDate: '131651Z NOV',
    inForceCount: 18,
    warnings: [
      {
        id: 'NAVAREA IV 1097/26',
        number: 1097,
        year: 26,
        area: 'CARIBBEAN SEA.',
        text: 'DERELICT VESSEL',
        positions: [{ lat: 17.05, lon: -61.96 }],
        positionParse: true,
        category: 'wreck',
        issuedAt: '131431Z NOV 26',
      },
      { id: '', text: 'no id' },
      null,
    ],
  });
  assert.equal(snapshot.warnings.length, 1);
  assert.equal(snapshot.warnings[0].id, 'NAVAREA IV 1097/26');
  assert.equal(validateNavareaSnapshot(null), null);
  assert.equal(validateNavareaSnapshot({ warnings: 'nope' }), null);
});
