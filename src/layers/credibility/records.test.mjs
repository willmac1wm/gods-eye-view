import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credibilityBand,
  formatBreakdownLine,
  normalizeCredibilityCluster,
  normalizeCredibilitySnapshot,
  validateCredibilitySnapshot,
} from './records.js';

test('credibilityBand edges: 80 High, 60 Medium, 0 Low, out-of-range null', () => {
  assert.equal(credibilityBand(100), 'High');
  assert.equal(credibilityBand(80), 'High');
  assert.equal(credibilityBand(79), 'Medium');
  assert.equal(credibilityBand(60), 'Medium');
  assert.equal(credibilityBand(59), 'Low');
  assert.equal(credibilityBand(0), 'Low');
  assert.equal(credibilityBand(null), null);
  assert.equal(credibilityBand(Number.NaN), null);
  assert.equal(credibilityBand(101), null);
  assert.equal(credibilityBand(-1), null);
});

const rawCluster = {
  incident_key: 'nws-freeze-2026-11-14',
  title: 'Freeze Warning — Cape May County',
  severity: 'Severe',
  credibility: 100,
  tier: 1,
  tier_label: 'Official',
  trend: 'Escalating',
  breakdown: [
    { rule: 'highest source tier: Official', points: 90 },
    { rule: 'corroborated by 1 additional source(s)', points: 10 },
  ],
  source_count: 2,
  sources: ['nws_mt_holly_alerts', 'capemay_scanner'],
  last_seen: 1794800000,
};

test('normalizeCredibilityCluster keeps the score, band, trend and working', () => {
  const cluster = normalizeCredibilityCluster(rawCluster, 0);
  assert.equal(cluster.incidentKey, 'nws-freeze-2026-11-14');
  assert.equal(cluster.credibility, 100);
  assert.equal(cluster.band, 'High');
  assert.equal(cluster.trend, 'Escalating');
  assert.equal(cluster.tierLabel, 'Official');
  assert.equal(cluster.sourceCount, 2);
  assert.deepEqual(cluster.sources, [
    'nws_mt_holly_alerts',
    'capemay_scanner',
  ]);
  assert.equal(cluster.breakdown.length, 2);
});

test('normalizeCredibilityCluster drops unscored clusters and bad trends', () => {
  assert.equal(
    normalizeCredibilityCluster({ ...rawCluster, credibility: null }),
    null,
  );
  assert.equal(normalizeCredibilityCluster(null), null);
  const badTrend = normalizeCredibilityCluster({
    ...rawCluster,
    trend: 'Skyrocketing',
  });
  assert.equal(badTrend.trend, null);
  assert.equal(badTrend.credibility, 100);
});

test('normalizeCredibilitySnapshot keeps clusters and the exclusion count', () => {
  const snapshot = normalizeCredibilitySnapshot({
    fetchedAt: 1794800000000,
    stale: false,
    count: 1,
    excluded_count: 2,
    clusters: [rawCluster],
  });
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.excludedCount, 2);
  assert.equal(snapshot.clusters.length, 1);
  assert.equal(normalizeCredibilitySnapshot({}), null);
  assert.equal(normalizeCredibilitySnapshot(null), null);
});

test('validateCredibilitySnapshot accepts an empty cluster list (quiet day)', () => {
  const snapshot = validateCredibilitySnapshot({
    fetchedAt: 1,
    stale: false,
    count: 0,
    excludedCount: 0,
    clusters: [],
  });
  assert.deepEqual(snapshot.clusters, []);
  assert.equal(
    validateCredibilitySnapshot({ fetchedAt: 1, clusters: null }),
    null,
  );
  assert.equal(
    validateCredibilitySnapshot({
      clusters: [{ credibility: 'high' }],
    }),
    null,
  );
});

test('formatBreakdownLine signs points and drops empty entries', () => {
  assert.equal(
    formatBreakdownLine({ rule: 'corroborated by 1 additional source(s)', points: 10 }),
    '+10 corroborated by 1 additional source(s)',
  );
  assert.equal(
    formatBreakdownLine({ rule: 'single unvetted source', points: -20 }),
    '−20 single unvetted source',
  );
  assert.equal(formatBreakdownLine({ rule: 'no change', points: 0 }), '0 no change');
  assert.equal(formatBreakdownLine({ rule: null, points: 10 }), null);
  assert.equal(formatBreakdownLine(null), null);
});
