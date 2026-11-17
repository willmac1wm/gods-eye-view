import { CREDIBILITY_BANDS, CREDIBILITY_TRENDS } from './policy.js';

// Marks text for i18n extraction; the UI translates it with t(). Kept local
// because AI tool services import this module outside the browser.
const msg = (text) => text;

/**
 * Score band for a credibility number (High / Medium / Low). Returns null
 * for anything that is not a finite 0–100 number — an unscored cluster is
 * never given a band.
 */
export function credibilityBand(score) {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  for (const band of CREDIBILITY_BANDS) {
    if (score >= band.min) return band.label;
  }
  return null;
}

/** Normalize one scored cluster from the /api/credibility payload. */
export function normalizeCredibilityCluster(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const key = text(raw?.incident_key) ?? `credibility-${index}`;
  const credibility = num(raw?.credibility);
  if (credibility === null) return null;
  const trend = text(raw?.trend);
  const breakdown = Array.isArray(raw?.breakdown)
    ? raw.breakdown
        .filter((b) => b && typeof b === 'object')
        .map((b) => ({
          rule: text(b?.rule),
          points: num(b?.points),
        }))
        .filter((b) => b.rule !== null && b.points !== null)
    : [];
  return {
    incidentKey: key,
    title: text(raw?.title),
    severity: text(raw?.severity),
    credibility,
    band: credibilityBand(credibility),
    tier: num(raw?.tier),
    tierLabel: text(raw?.tier_label),
    trend: CREDIBILITY_TRENDS.includes(trend) ? trend : null,
    breakdown,
    sourceCount: num(raw?.source_count) ?? raw?.sources?.length ?? null,
    sources: Array.isArray(raw?.sources)
      ? raw.sources.map((s) => String(s)).filter(Boolean)
      : [],
    lastSeen: num(raw?.last_seen),
  };
}

/** Normalize the whole /api/credibility payload into a snapshot. */
export function normalizeCredibilitySnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload?.clusters)) return null;
  const clusters = payload.clusters
    .map((raw, index) => normalizeCredibilityCluster(raw, index))
    .filter(Boolean);
  return {
    fetchedAt: payload?.fetchedAt ?? null,
    stale: payload?.stale === true,
    count: clusters.length,
    excludedCount:
      Number.isFinite(payload?.excluded_count) && payload.excluded_count >= 0
        ? payload.excluded_count
        : 0,
    clusters,
  };
}

/**
 * Validate a normalized snapshot. A snapshot with no clusters is valid —
 * a quiet news day is a real steady state — but a missing clusters array
 * or a cluster without a score is malformed.
 */
export function validateCredibilitySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!Array.isArray(snapshot?.clusters)) return null;
  for (const cluster of snapshot.clusters) {
    if (!Number.isFinite(cluster?.credibility)) return null;
    if (credibilityBand(cluster.credibility) === null) return null;
  }
  return snapshot;
}

/** One-line breakdown rendering for the overlay details ("+10 corroborated…"). */
export function formatBreakdownLine(entry) {
  if (!entry || entry.rule === null || entry.points === null) return null;
  const sign = entry.points > 0 ? '+' : entry.points < 0 ? '−' : '';
  return `${sign}${Math.abs(entry.points)} ${entry.rule}`;
}
