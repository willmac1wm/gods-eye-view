// src/layers/sanctionsWatch/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReportingVessels,
  coverageIsAlive,
  detectSignals,
  detectSilence,
  impliedSpeedKn,
  isSanctionsMatch,
  isValidImo,
  normalizeImo,
  validateScreening,
} from './records.js';

// Live ArcNautical keyless check, IMO 9169067, 2026-11-17 ~03:19 UTC.
const LIVE_CHECK = {
  imo: '9169067',
  vesselName: 'MSC MIA SUMMER II',
  alsoRecordedAs: [],
  identityBasis: 'sources',
  checkDigitValid: true,
  sanctions: {
    status: 'GREEN',
    detail:
      'No matches across OFAC SDN, OpenSanctions, EU FSD, UN Consolidated, UK OFSI for this vessel\u2019s identifiers and current name. Prior names are not screened: a hull designated under a FORMER name, in a source record that carries no IMO, will not be matched here.',
    detailKey: 'verdict.sanctions.green',
    coverageComplete: true,
    coverageGaps: [],
  },
  ownership: { opacity: 'HIGH', score: 70 },
  vetting: { grade: 'C', score: 43, status: 'marginal' },
  assessed: true,
  checkedAt: '2026-11-17T03:19:09.016Z',
  provider: 'ArcNautical',
  fullReport: 'https://arcnautical.com/check?imo=9169067',
  tier: 'keyless',
  tierDetail: 'Verdict summary only.',
};

test('IMO numbers validate with the 7-digit check digit', () => {
  assert.equal(normalizeImo(' 9169067 '), '9169067');
  assert.equal(normalizeImo('916-9067'), '9169067');
  assert.equal(normalizeImo('916906'), null);
  assert.equal(normalizeImo('ABCDEFG'), null);
  assert.equal(isValidImo('9169067'), true);
  assert.equal(isValidImo('1234567'), true);
  assert.equal(isValidImo('9169068'), false);
  assert.equal(isValidImo('1234568'), false);
});

test('live ArcNautical fixture normalizes to GREEN / HIGH 70 / C 43', () => {
  const screening = validateScreening(LIVE_CHECK);
  assert.equal(screening.imo, '9169067');
  assert.equal(screening.vesselName, 'MSC MIA SUMMER II');
  assert.equal(screening.sanctionsStatus, 'GREEN');
  assert.equal(screening.coverageComplete, true);
  assert.deepEqual(screening.coverageGaps, []);
  assert.equal(screening.ownershipOpacity, 'HIGH');
  assert.equal(screening.ownershipScore, 70);
  assert.equal(screening.vettingGrade, 'C');
  assert.equal(screening.vettingScore, 43);
  assert.equal(screening.checkedAt, '2026-11-17T03:19:09.016Z');
  assert.equal(
    screening.fullReport,
    'https://arcnautical.com/check?imo=9169067',
  );
  assert.equal(isSanctionsMatch(screening), false);
  const matched = validateScreening({
    ...LIVE_CHECK,
    sanctions: { status: 'MATCH', detail: 'OFAC SDN match' },
  });
  assert.equal(isSanctionsMatch(matched), true);
  assert.equal(matched.sanctionsStatus, 'MATCH');
});

test('screening validation rejects non-screenings, never a clean verdict', () => {
  assert.equal(validateScreening(null), null);
  assert.equal(validateScreening({}), null);
  assert.equal(validateScreening({ imo: '9169067' }), null);
  assert.equal(validateScreening({ imo: '9169068', sanctions: {} }), null);
});

test('impossible reported speed is a signal, plausible speed is not', () => {
  const fast = detectSignals(
    { mmsi: '1', speedKts: 35, lastPositionEpoch: 1000 },
    null,
  );
  assert.deepEqual(
    fast.map((signal) => signal.kind),
    ['impossible-speed'],
  );
  assert.equal(
    detectSignals(
      { mmsi: '1', speedKts: 12, lastPositionEpoch: 1000 },
      null,
    ).length,
    0,
  );
});

test('implied speed between fixes flags spoofed positions', () => {
  const previous = {
    lat: 39.0,
    lon: -74.8,
    lastPositionEpoch: 0,
  };
  const current = {
    mmsi: '1',
    lat: 39.5,
    lon: -74.8,
    speedKts: 12,
    lastPositionEpoch: 30 * 60 * 1000,
  };
  const implied = impliedSpeedKn(previous, current);
  assert.ok(implied > 50, `implied ${implied} kn`);
  assert.deepEqual(
    detectSignals(current, previous).map((signal) => signal.kind),
    ['implied-speed'],
  );
  assert.ok(
    impliedSpeedKn(previous, { ...current, lat: 39.01 }) < 50,
    'a short hop in the same window is not an impossible speed',
  );
});

test('identity change flags a new name or IMO on the same MMSI', () => {
  const previous = {
    mmsi: '1',
    name: 'OLD NAME',
    imo: '9169067',
    lat: 39.0,
    lon: -74.8,
    lastPositionEpoch: 0,
  };
  const renamed = detectSignals(
    {
      mmsi: '1',
      name: 'NEW NAME',
      imo: '9169067',
      lat: 39.0,
      lon: -74.8,
      speedKts: 10,
      lastPositionEpoch: 60_000,
    },
    previous,
  );
  assert.deepEqual(
    renamed.map((signal) => signal.kind),
    ['identity-change'],
  );
  const same = detectSignals(
    {
      mmsi: '1',
      name: 'OLD NAME',
      imo: '9169067',
      lat: 39.0,
      lon: -74.8,
      speedKts: 10,
      lastPositionEpoch: 60_000,
    },
    previous,
  );
  assert.equal(same.length, 0);
});

test('silence needs coverage alive and >6 h without a fix', () => {
  const seen = { lastPositionEpoch: 0, lastSeenMs: 0 };
  assert.equal(detectSilence(seen, 7 * 3_600_000, true)?.kind, 'silence');
  assert.equal(detectSilence(seen, 7 * 3_600_000, true)?.detail, 'Last seen 7 h ago');
  assert.equal(detectSilence(seen, 5 * 3_600_000, true), null);
  assert.equal(detectSilence(seen, 7 * 3_600_000, false), null);
});

test('coverage is alive with 3 vessels reporting in the last 15 min', () => {
  const nowMs = 1_000_000;
  const records = [
    { mmsi: 'a', lastPositionEpoch: nowMs - 60_000 },
    { mmsi: 'b', lastPositionEpoch: nowMs - 120_000 },
    { mmsi: 'c', lastPositionEpoch: nowMs - 14 * 60_000 },
    { mmsi: 'd', lastPositionEpoch: nowMs - 60 * 60_000 },
  ];
  assert.equal(countReportingVessels(records, nowMs), 3);
  assert.equal(coverageIsAlive(records, nowMs), true);
  assert.equal(
    coverageIsAlive(records.slice(0, 2), nowMs),
    false,
  );
});
