import { HISTORY_BUCKET_MS, HISTORY_FEED_LOOKBACK_MS } from './policy.js';

/** Normalize one stored aircraft row from /api/history/aircraft. */
export function normalizeAircraftRow(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const hex = text(raw?.hex) ?? `history-${index}`;
  const lat = num(raw?.lat);
  const lon = num(raw?.lon);
  const seenAt = num(raw?.seen_at);
  if (lat === null || lon === null || seenAt === null) return null;
  return {
    hex,
    kind: text(raw?.kind),
    flight: text(raw?.flight),
    lat,
    lon,
    alt: num(raw?.alt),
    speed: num(raw?.speed),
    track: num(raw?.track),
    seenAt,
  };
}

/** Normalize one stored feed row from /api/history/feed. */
export function normalizeFeedRow(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  const num = (v) => (Number.isFinite(v) ? v : null);
  const id = text(raw?.id) ?? `history-feed-${index}`;
  const title = text(raw?.title);
  const pubMs = num(raw?.pub_ms);
  if (title === null || pubMs === null) return null;
  return {
    id,
    source: text(raw?.source),
    sourceLabel: text(raw?.source_label),
    cat: text(raw?.cat),
    type: text(raw?.type),
    title,
    lat: num(raw?.lat),
    lng: num(raw?.lng),
    pubMs,
  };
}

/** Normalize the /api/history/status payload. */
export function normalizeHistoryStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const aircraftRows = num(payload?.aircraftRows);
  const feedRows = num(payload?.feedRows);
  if (aircraftRows === null || feedRows === null) return null;
  return {
    aircraftRows,
    feedRows,
    oldestMs: num(payload?.oldestMs),
    newestMs: num(payload?.newestMs),
  };
}

/** Normalize one /api/history/aircraft (or /feed) window payload. */
export function normalizeHistoryWindow(payload, normalizeRow) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Array.isArray(payload?.rows)) return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    count: payload.rows.length,
    fromMs: num(payload?.fromMs),
    untilMs: num(payload?.untilMs),
    rows: payload.rows.map(normalizeRow).filter(Boolean),
  };
}

/**
 * Latest stored position per hex at cursor T: the newest row with
 * seen_at <= T, one pin per aircraft. Rows after T are not shown —
 * the replay never peeks into the future.
 */
export function positionsAt(rows, cursorMs) {
  const latest = new Map();
  for (const row of rows ?? []) {
    if (!Number.isFinite(row?.seenAt) || row.seenAt > cursorMs) continue;
    const prev = latest.get(row.hex);
    if (!prev || row.seenAt >= prev.seenAt) latest.set(row.hex, row);
  }
  return [...latest.values()].sort((a, b) => a.seenAt - b.seenAt);
}

/**
 * Feed items the replay shows at cursor T: published in the lookback
 * before T (default 15 min). Older items have already scrolled past;
 * newer ones have not happened yet.
 */
export function feedAt(rows, cursorMs, lookbackMs = HISTORY_FEED_LOOKBACK_MS) {
  return (rows ?? [])
    .filter(
      (row) =>
        Number.isFinite(row?.pubMs) &&
        row.pubMs <= cursorMs &&
        row.pubMs > cursorMs - lookbackMs,
    )
    .sort((a, b) => a.pubMs - b.pubMs);
}

/**
 * 15-minute buckets over the fetched window for the row-control jump
 * list: each bucket carries its start and the aircraft/feed counts in
 * it. Empty buckets are kept — the list is the window's honest shape,
 * and an empty bucket jumps to a quiet stretch on purpose.
 */
export function timeBuckets(
  aircraftRows,
  feedRows,
  fromMs,
  untilMs,
  bucketMs = HISTORY_BUCKET_MS,
) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) return [];
  if (untilMs <= fromMs) return [];
  const buckets = [];
  for (let start = fromMs; start < untilMs; start += bucketMs) {
    buckets.push({ startMs: start, aircraft: 0, feed: 0 });
  }
  const place = (ms) => {
    if (!Number.isFinite(ms)) return -1;
    const index = Math.floor((ms - fromMs) / bucketMs);
    return index >= 0 && index < buckets.length ? index : -1;
  };
  for (const row of aircraftRows ?? []) {
    const index = place(row?.seenAt);
    if (index >= 0) buckets[index].aircraft += 1;
  }
  for (const row of feedRows ?? []) {
    const index = place(row?.pubMs);
    if (index >= 0) buckets[index].feed += 1;
  }
  return buckets;
}

/** Format a replay cursor as a short local time ("8:00 PM"). */
export function formatReplayTime(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
