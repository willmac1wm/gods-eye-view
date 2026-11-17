// src/layers/internetOutages/model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInternetOutagesOverlayEntry,
  mapAnalystRecord,
  INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT,
} from './model.js';
import {
  normalizeIodaAlertRow,
  normalizeIodaSummaryRow,
} from './records.js';

const CRITICAL_ALERT = normalizeIodaAlertRow({
  datasource: 'bgp',
  entity: { code: '7821', name: 'AS7821 (ZAYO-MN)', type: 'asn' },
  time: 1794822000,
  level: 'critical',
  condition: '< 0.99',
  value: 0,
  historyValue: 37,
  method: 'median',
});

const SUMMARY_ROW = normalizeIodaSummaryRow({
  scores: { 'bgp.median': 855760, overall: 855760 },
  event_cnt: 207,
  entity: { code: '7821', name: 'AS7821 (ZAYO-MN)', type: 'asn' },
});

function snapshot(overrides = {}) {
  return {
    fetchedAt: 1_793_123_456_789,
    stale: false,
    ttlMs: 300_000,
    usSummary: [],
    njSummary: [],
    alerts: [],
    counts: {
      usSummary: 0,
      njSummary: 0,
      alerts: 0,
      criticalAlerts: 0,
    },
    ...overrides,
  };
}

test('a quiet window gets a green NJ-quiet anchor label', () => {
  assert.equal(INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT, 1);
  const entry = createInternetOutagesOverlayEntry({ snapshot: snapshot() });
  assert.equal(entry.id, 'internet-outages');
  assert.match(entry.title, /Internet outages · NJ quiet/);
  assert.match(entry.subtitle, /0 alerts worldwide/);
  assert.equal(entry.accent, 'rgb(124,255,155)');
});

test('a critical alert turns the anchor red and counts it', () => {
  const entry = createInternetOutagesOverlayEntry({
    snapshot: snapshot({
      alerts: [CRITICAL_ALERT],
      counts: {
        usSummary: 0,
        njSummary: 0,
        alerts: 1,
        criticalAlerts: 1,
      },
    }),
  });
  assert.match(entry.title, /Internet outages · NJ quiet/);
  assert.match(entry.subtitle, /1 critical · 1 alerts worldwide/);
  assert.equal(entry.accent, 'rgb(255,107,107)');
  assert.equal(entry.priority, 2);
});

test('the analyst record carries the IODA fields, nothing more', () => {
  const alert = mapAnalystRecord(CRITICAL_ALERT, 0);
  assert.equal(alert.kind, 'alert');
  assert.equal(alert.id, 'IODA-7821-1794822000');
  assert.equal(alert.level, 'critical');
  assert.equal(alert.value, 0);
  assert.equal(alert.historyValue, 37);
  const summary = mapAnalystRecord(SUMMARY_ROW, 1);
  assert.equal(summary.kind, 'summary');
  assert.equal(summary.id, '7821');
  assert.equal(summary.overallScore, 855760);
  assert.equal(summary.eventCount, 207);
});
