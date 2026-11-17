// src/layers/internetOutages/records.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertLevelRank,
  criticalIodaAlerts,
  normalizeIodaAlertRow,
  normalizeIodaSnapshot,
  normalizeIodaSummaryRow,
  sortIodaAlerts,
  sortIodaSummaryRows,
} from './records.js';

// Fixtures are verbatim live IODA rows from 2026-11-17, as the server
// provider returns them (raw API rows, not fetched at test time).
const CRITICAL_ALERT = {
  datasource: 'bgp',
  entity: {
    code: '7821',
    name: 'AS7821 (ZAYO-MN)',
    subnames: [],
    type: 'asn',
    attrs: {
      name: 'ZAYO-MN',
      fqid: 'asn.7821',
      ip_count: '9472',
      org: 'Inteliquent, inc.',
    },
  },
  time: 1794822000,
  level: 'critical',
  condition: '< 0.99',
  value: 0,
  historyValue: 37,
  method: 'median',
};

const NORMAL_ALERT = {
  datasource: 'bgp',
  entity: {
    code: '58540',
    name: 'AS58540 (CHINATELECOM-SHANDONG-JINAN-IDC)',
    subnames: [],
    type: 'asn',
    attrs: {
      ip_count: '86016',
      name: 'CHINATELECOM-SHANDONG-JINAN-IDC',
      org: 'Jinan,250000',
      fqid: 'asn.58540',
    },
  },
  time: 1794822000,
  level: 'normal',
  condition: 'normal',
  value: 332,
  historyValue: 332,
  method: 'median',
};

const SUMMARY_ROW = {
  scores: {
    'bgp.median': 855760,
    overall: 855760,
  },
  event_cnt: 207,
  entity: {
    code: '7821',
    name: 'AS7821 (ZAYO-MN)',
    subnames: [],
    type: 'asn',
    attrs: {
      name: 'ZAYO-MN',
      fqid: 'asn.7821',
      ip_count: '9472',
      org: 'Inteliquent, inc.',
    },
  },
};

test('the critical ZAYO alert normalizes with its IODA fields intact', () => {
  const row = normalizeIodaAlertRow(CRITICAL_ALERT);
  assert.equal(row.kind, 'alert');
  assert.equal(row.entityCode, '7821');
  assert.equal(row.entityName, 'AS7821 (ZAYO-MN)');
  assert.equal(row.entityType, 'asn');
  assert.equal(row.datasource, 'bgp');
  assert.equal(row.time, 1794822000);
  assert.equal(row.timeIso, '2026-11-16T09:40:00.000Z');
  assert.equal(row.level, 'critical');
  assert.equal(row.levelRank, 2);
  assert.equal(row.condition, '< 0.99');
  assert.equal(row.method, 'median');
  assert.equal(row.value, 0);
  assert.equal(row.historyValue, 37);
  assert.equal(row.valueRatio, 0);
});

test('the normal alert keeps value == baseline, and ranks below critical', () => {
  const row = normalizeIodaAlertRow(NORMAL_ALERT);
  assert.equal(row.level, 'normal');
  assert.equal(row.levelRank, 1);
  assert.equal(row.value, 332);
  assert.equal(row.historyValue, 332);
  assert.equal(row.valueRatio, 1);
  assert.equal(alertLevelRank('critical'), 2);
  assert.equal(alertLevelRank('normal'), 1);
  assert.equal(alertLevelRank('weird'), 0);
});

test('the ASN summary row keeps IODA’s own overall score', () => {
  const row = normalizeIodaSummaryRow(SUMMARY_ROW);
  assert.equal(row.kind, 'summary');
  assert.equal(row.entityCode, '7821');
  assert.equal(row.overallScore, 855760);
  assert.equal(row.eventCount, 207);
  assert.deepEqual(row.sourceScores, { 'bgp.median': 855760 });
});

test('rows without an entity code, score, or time are dropped, not guessed', () => {
  assert.equal(
    normalizeIodaAlertRow({ ...CRITICAL_ALERT, entity: null }),
    null,
  );
  assert.equal(normalizeIodaAlertRow({ ...CRITICAL_ALERT, time: 'x' }), null);
  assert.equal(normalizeIodaAlertRow(null), null);
  assert.equal(
    normalizeIodaSummaryRow({ ...SUMMARY_ROW, scores: { overall: 'x' } }),
    null,
  );
  assert.equal(
    normalizeIodaSummaryRow({ ...SUMMARY_ROW, entity: { code: '' } }),
    null,
  );
  assert.equal(normalizeIodaSummaryRow(null), null);
});

test('critical alerts filter out, newest first; summaries sort by score', () => {
  const alerts = [
    normalizeIodaAlertRow({ ...NORMAL_ALERT, time: 1794821999 }),
    normalizeIodaAlertRow(CRITICAL_ALERT),
  ];
  assert.deepEqual(
    criticalIodaAlerts(alerts).map((row) => row.entityCode),
    ['7821'],
  );
  assert.deepEqual(
    sortIodaAlerts(alerts).map((row) => row.entityCode),
    ['7821', '58540'],
  );
  const rows = [
    { ...SUMMARY_ROW, scores: { overall: 10 }, event_cnt: 1 },
    SUMMARY_ROW,
  ].map(normalizeIodaSummaryRow);
  assert.deepEqual(
    sortIodaSummaryRows(rows).map((row) => row.overallScore),
    [855760, 10],
  );
});

test('a malformed snapshot is rejected whole; junk rows are dropped', () => {
  assert.equal(normalizeIodaSnapshot(null), null);
  assert.equal(normalizeIodaSnapshot({ fetchedAt: 1_793_123_456_789 }), null);
  assert.equal(
    normalizeIodaSnapshot({
      fetchedAt: 1_793_123_456_789,
      usSummary: [],
      njSummary: [],
    }),
    null,
  );
  const snapshot = normalizeIodaSnapshot({
    fetchedAt: 1_793_123_456_789,
    stale: false,
    ttlMs: 300_000,
    usSummary: [],
    njSummary: [],
    alerts: [CRITICAL_ALERT, { nope: true }, NORMAL_ALERT],
  });
  assert.equal(snapshot.counts.alerts, 2);
  assert.equal(snapshot.counts.criticalAlerts, 1);
  assert.equal(snapshot.counts.usSummary, 0);
  // A quiet window is a valid snapshot, not an error.
  const quiet = normalizeIodaSnapshot({
    fetchedAt: 1_793_123_456_789,
    usSummary: [],
    njSummary: [],
    alerts: [],
  });
  assert.equal(quiet.counts.alerts, 0);
  assert.equal(quiet.counts.criticalAlerts, 0);
  assert.deepEqual(quiet.alerts, []);
});
