/**
 * Analyst seam (mirror of mapAnalystRecord). Pure — no Cesium types.
 * One record per H3 cell, positioned at its centroid.
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.hex)
      ? `gpsjam-daily:${raw.hex}`
      : `gpsjam-daily-${String(index).padStart(4, '0')}`,
    hex: text(raw?.hex),
    date: text(raw?.date),
    source: text(raw?.source),
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    hasPosition: raw?.hasPosition === true,
    level: text(raw?.level),
    percent: num(raw?.percent),
    aircraft: num(raw?.total),
    degraded: num(raw?.bad),
    state: text(raw?.state),
    interpretation: text(raw?.interpretation),
  };
}
