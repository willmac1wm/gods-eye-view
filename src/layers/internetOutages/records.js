// src/layers/internetOutages/records.js
// Pure record rules for IODA outage summaries and alerts: normalize the
// raw IODA rows the server provider returns, rank summaries by IODA's own
// overall score, and separate critical alerts. No network, no Cesium, no
// clock. Scores and levels are IODA's own — never re-scored here.
// Whole-payload rejection mirrors normalizeGdacsSnapshot: a malformed
// payload never partially overwrites good data.
import { IODA_ALERT_LEVEL_RANK } from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function entityValue(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity))
    return null;
  const code = textValue(entity.code);
  if (!code) return null;
  return {
    code,
    name: textValue(entity.name),
    type: textValue(entity.type),
  };
}

/** IODA alert level rank (literal source level; critical outranks the rest). */
export function alertLevelRank(level) {
  return IODA_ALERT_LEVEL_RANK[level] ?? 0;
}

/**
 * Normalize one IODA summary row
 * ({entity, scores: {overall, ...}, event_cnt}) to a display row, or null
 * when it is not a usable row. A row needs an entity code and a numeric
 * overall score.
 */
export function normalizeIodaSummaryRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entity = entityValue(raw.entity);
  if (!entity) return null;
  const scores =
    raw.scores && typeof raw.scores === 'object' && !Array.isArray(raw.scores)
      ? raw.scores
      : null;
  const overall = scores ? numValue(scores.overall) : null;
  if (overall === null) return null;
  const sourceScores = {};
  for (const [key, value] of Object.entries(scores)) {
    if (key === 'overall') continue;
    const parsed = numValue(value);
    if (parsed !== null) sourceScores[key] = parsed;
  }
  return {
    kind: 'summary',
    entityCode: entity.code,
    entityName: entity.name,
    entityType: entity.type,
    overallScore: overall,
    eventCount: numValue(raw.event_cnt) ?? 0,
    sourceScores,
  };
}

/**
 * Normalize one IODA alert row
 * ({entity, datasource, time, level, condition, method, value,
 * historyValue}) to a display row, or null when it is not a usable row.
 * An alert needs an entity code and a numeric transition time. The level
 * is IODA's literal value (critical / normal / ...), kept verbatim.
 */
export function normalizeIodaAlertRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entity = entityValue(raw.entity);
  if (!entity) return null;
  const time = numValue(raw.time);
  if (time === null) return null;
  const value = numValue(raw.value);
  const historyValue = numValue(raw.historyValue);
  return {
    kind: 'alert',
    entityCode: entity.code,
    entityName: entity.name,
    entityType: entity.type,
    datasource: textValue(raw.datasource),
    time,
    timeIso: new Date(time * 1000).toISOString(),
    level: textValue(raw.level),
    levelRank: alertLevelRank(raw.level),
    condition: textValue(raw.condition),
    method: textValue(raw.method),
    value,
    historyValue,
    // Fraction of the baseline still visible (bgp value 0 vs history 37 =
    // total loss). Null when no baseline was reported.
    valueRatio:
      value !== null && historyValue !== null && historyValue > 0
        ? value / historyValue
        : null,
  };
}

/**
 * Validate a provider payload and normalize its rows. Returns the snapshot
 * or null when malformed. Empty arrays are valid snapshots (a quiet window),
 * but only when the envelope is well-formed.
 */
export function normalizeIodaSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (typeof payload.fetchedAt !== 'number') return null;
  if (
    !Array.isArray(payload.usSummary) ||
    !Array.isArray(payload.njSummary) ||
    !Array.isArray(payload.alerts)
  )
    return null;
  const usSummary = [];
  for (const raw of payload.usSummary) {
    const row = normalizeIodaSummaryRow(raw);
    if (row) usSummary.push(row);
  }
  const njSummary = [];
  for (const raw of payload.njSummary) {
    const row = normalizeIodaSummaryRow(raw);
    if (row) njSummary.push(row);
  }
  const alerts = [];
  for (const raw of payload.alerts) {
    const row = normalizeIodaAlertRow(raw);
    if (row) alerts.push(row);
  }
  return {
    fetchedAt: payload.fetchedAt,
    stale: payload.stale === true,
    ttlMs:
      typeof payload.ttlMs === 'number' && payload.ttlMs > 0
        ? payload.ttlMs
        : null,
    window: payload.window ?? null,
    usSummary,
    njSummary,
    alerts,
    counts: {
      usSummary: usSummary.length,
      njSummary: njSummary.length,
      alerts: alerts.length,
      criticalAlerts: alerts.filter((row) => row.level === 'critical').length,
    },
  };
}

/** Highest IODA overall score first. */
export function sortIodaSummaryRows(rows) {
  return [...rows].sort((a, b) => b.overallScore - a.overallScore);
}

/** Newest alert transition first. */
export function sortIodaAlerts(rows) {
  return [...rows].sort((a, b) => b.time - a.time);
}

/** Critical alerts only, newest first. */
export function criticalIodaAlerts(rows) {
  return sortIodaAlerts(rows.filter((row) => row.level === 'critical'));
}
