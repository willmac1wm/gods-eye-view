import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORM_EVENTS_SNAPSHOT,
  countStormEventsByType,
  groupDeclarationsByDecade,
  normalizeDeclaration,
  normalizeOpenFemaResponse,
  parseStormDamage,
  summarizeStormEventYears,
  validateDisasterSnapshot,
} from './records.js';

// Live OpenFEMA rows, 2026-11-16 (filter state='NJ', designatedArea='Cape May (County)').
const IDA_ROW = {
  femaDeclarationString: 'DR-4614-NJ',
  disasterNumber: 4614,
  state: 'NJ',
  declarationType: 'DR',
  declarationDate: '2021-09-05T00:00:00.000Z',
  incidentType: 'Hurricane',
  declarationTitle: 'REMNANTS OF HURRICANE IDA',
  ihProgramDeclared: false,
  iaProgramDeclared: false,
  paProgramDeclared: true,
  hmProgramDeclared: true,
  incidentBeginDate: '2021-09-01T00:00:00.000Z',
  incidentEndDate: '2021-09-03T00:00:00.000Z',
  fipsCountyCode: '009',
  designatedArea: 'Cape May (County)',
};

const EARLIEST_ROW = {
  femaDeclarationString: 'DR-205-NJ',
  disasterNumber: 205,
  declarationType: 'DR',
  declarationDate: '1965-08-18T00:00:00.000Z',
  incidentType: 'Drought',
  declarationTitle: 'WATER SHORTAGE',
  paProgramDeclared: true,
  iaProgramDeclared: false,
  hmProgramDeclared: false,
  incidentBeginDate: '1965-08-18T00:00:00.000Z',
  incidentEndDate: null,
};

test('normalizeDeclaration keeps the Ida row with its programs', () => {
  const row = normalizeDeclaration(IDA_ROW);
  assert.equal(row.id, 'DR-4614-NJ');
  assert.equal(row.disasterNumber, 4614);
  assert.equal(row.declarationType, 'DR');
  assert.equal(row.incidentType, 'Hurricane');
  assert.equal(row.declarationTitle, 'REMNANTS OF HURRICANE IDA');
  assert.equal(row.incidentBeginDate, '2021-09-01T00:00:00.000Z');
  assert.equal(row.incidentEndDate, '2021-09-03T00:00:00.000Z');
  assert.deepEqual(row.programs, {
    publicAssistance: true,
    individualAssistance: false,
    hazardMitigation: true,
  });
});

test('normalizeDeclaration drops rows without an id, a date or a type', () => {
  assert.equal(normalizeDeclaration(null), null);
  assert.equal(normalizeDeclaration({ ...IDA_ROW, femaDeclarationString: '' }), null);
  assert.equal(normalizeDeclaration({ ...IDA_ROW, declarationDate: 'not-a-date' }), null);
  assert.equal(normalizeDeclaration({ ...IDA_ROW, incidentType: '' }), null);
});

test('normalizeOpenFemaResponse sorts newest first and honors metadata.count', () => {
  const payload = {
    metadata: { count: 34 },
    DisasterDeclarationsSummaries: [EARLIEST_ROW, IDA_ROW],
  };
  const result = normalizeOpenFemaResponse(payload);
  assert.equal(result.count, 34);
  assert.equal(result.declarations.length, 2);
  assert.equal(result.declarations[0].id, 'DR-4614-NJ');
  assert.equal(result.declarations[1].id, 'DR-205-NJ');
});

test('normalizeOpenFemaResponse rejects malformed or empty payloads', () => {
  assert.equal(normalizeOpenFemaResponse(null), null);
  assert.equal(normalizeOpenFemaResponse({}), null);
  assert.equal(
    normalizeOpenFemaResponse({ DisasterDeclarationsSummaries: [] }),
    null,
  );
  assert.equal(
    normalizeOpenFemaResponse({
      DisasterDeclarationsSummaries: [{ femaDeclarationString: 'x' }],
    }),
    null,
  );
});

test('parseStormDamage converts K/M/B suffixes and never zeroes a blank', () => {
  assert.equal(parseStormDamage('125.00M'), 125_000_000);
  assert.equal(parseStormDamage('50.00M'), 50_000_000);
  assert.equal(parseStormDamage('0.00K'), 0);
  assert.equal(parseStormDamage('2.50B'), 2_500_000_000);
  assert.equal(parseStormDamage(''), null);
  assert.equal(parseStormDamage(null), null);
  assert.equal(parseStormDamage('nonsense'), null);
});

test('snapshot: 2025 county rows match the live NCEI count and types', () => {
  const rows = STORM_EVENTS_SNAPSHOT.years['2025'];
  assert.equal(rows.length, 27);
  const byType = countStormEventsByType(rows);
  assert.deepEqual(byType[0], { type: 'Winter Weather', count: 7 });
  assert.deepEqual(
    byType.map((entry) => entry.type),
    [
      'Winter Weather',
      'Coastal Flood',
      'High Wind',
      'Winter Storm',
      'Dense Fog',
      'Flash Flood',
      'Thunderstorm Wind',
      'Excessive Heat',
      'Hail',
    ],
  );
  const summary = summarizeStormEventYears({ '2025': rows });
  assert.equal(summary['2025'].deaths, 0);
  assert.equal(summary['2025'].injuries, 0);
});

test('snapshot: Sandy rows carry the county damage total', () => {
  const rows = STORM_EVENTS_SNAPSHOT.years['2012'];
  assert.equal(rows.length, 78);
  const sandy = rows.filter((row) =>
    (row.begin_date_time ?? '').startsWith('28-OCT-12') ||
    (row.begin_date_time ?? '').startsWith('29-OCT-12'),
  );
  assert.equal(sandy.length, 6);
  const sandySummary = summarizeStormEventYears({ '2012': sandy });
  assert.equal(sandySummary['2012'].damagePropertyTotal, 415_000_000);
  // The 4 injuries in 2012 are not in the Sandy rows — they sit in other
  // rows of the year, so injuries are asserted on the year summary below.
  // The full 2012 year total is a little higher: the remaining
  // $1,012,170 is spread over many small wind/flood rows through the year
  // (largest: a $750K thunderstorm-wind row, 29-Jun-12).
  const summary = summarizeStormEventYears({ '2012': rows });
  assert.equal(summary['2012'].damagePropertyTotal, 416_012_170);
  assert.equal(summary['2012'].injuries, 4);
});

test('snapshot covers the four generated years with their source files', () => {
  assert.deepEqual(Object.keys(STORM_EVENTS_SNAPSHOT.years).sort(), [
    '2012',
    '2021',
    '2024',
    '2025',
  ]);
  assert.equal(
    STORM_EVENTS_SNAPSHOT.sourceFiles['2025'],
    'StormEvents_details-ftp_v1.0_d2025_c20260819.csv.gz',
  );
  const total = Object.values(STORM_EVENTS_SNAPSHOT.years).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  assert.equal(total, 145);
});

test('groupDeclarationsByDecade groups newest decade first', () => {
  const groups = groupDeclarationsByDecade([
    normalizeDeclaration(EARLIEST_ROW),
    normalizeDeclaration(IDA_ROW),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.decade, group.count]),
    [
      ['2020s', 1],
      ['1960s', 1],
    ],
  );
});

test('validateDisasterSnapshot accepts a full snapshot and rejects a thin one', () => {
  const snapshot = {
    fetchedAt: 1,
    stale: false,
    declarations: [normalizeDeclaration(IDA_ROW)],
    declarationCount: 34,
    stormEvents: { years: STORM_EVENTS_SNAPSHOT.years, summary: {} },
  };
  assert.equal(validateDisasterSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateDisasterSnapshot({ ...snapshot, declarations: [] }),
    /invalid snapshot/,
  );
  assert.throws(
    () => validateDisasterSnapshot({ ...snapshot, stormEvents: null }),
    /invalid snapshot/,
  );
});
