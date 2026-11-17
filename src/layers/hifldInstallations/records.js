// src/layers/hifldInstallations/records.js
// Pure record rules for the HIFLD MIRTA snapshot: validation,
// normalization, and the state/search helpers the panel uses. No
// network, no Cesium, no clock. Statuses are MIRTA's own codes,
// lowercased (the source mixes 'EXCS' and 'excs'); an empty status is
// 'unknown', never guessed. Whole-payload rejection mirrors
// normalizeGdacsSnapshot: a malformed snapshot never partially
// overwrites good data, and a short snapshot (fewer rows than the
// pinned feature count) fails closed instead of publishing partial.
import { HIFLD_HOME_STATES, HIFLD_SNAPSHOT_FEATURE_COUNT } from './policy.js';

export function numValue(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

/** MIRTA status code, lowercased; empty means unknown, never guessed. */
export function statusValue(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  return text || 'unknown';
}

/**
 * Normalize one snapshot row, or null when it has no usable id, name,
 * state, status, or position. The joint flag must be a boolean; a
 * missing component or installation id stays null.
 */
export function normalizeHifldSite(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = textValue(raw.id);
  const name = textValue(raw.name);
  const state = textValue(raw.state)?.toLowerCase() ?? null;
  const lat = numValue(raw.lat);
  const lon = numValue(raw.lon);
  if (!id || !name || !state || lat === null || lon === null) return null;
  if (typeof raw.joint !== 'boolean') return null;
  return {
    kind: 'installation',
    id,
    name,
    state,
    status: statusValue(raw.status),
    component: textValue(raw.component),
    joint: raw.joint,
    installationId: textValue(raw.installationId),
    lat,
    lon,
  };
}

/**
 * Validate a snapshot envelope and normalize its rows. Returns the
 * snapshot or null when malformed. The row count must match the
 * pinned feature count exactly — a short snapshot fails closed.
 */
export function validateSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  if (payload.featureCount !== HIFLD_SNAPSHOT_FEATURE_COUNT) return null;
  if (typeof payload.freezeDate !== 'string' || !payload.freezeDate)
    return null;
  if (typeof payload.freezeNote !== 'string' || !payload.freezeNote)
    return null;
  if (!Array.isArray(payload.sites)) return null;
  const sites = [];
  for (const raw of payload.sites) {
    const site = normalizeHifldSite(raw);
    if (!site) return null;
    sites.push(site);
  }
  if (sites.length !== HIFLD_SNAPSHOT_FEATURE_COUNT) return null;
  return {
    source: textValue(payload.source),
    producer: textValue(payload.producer),
    host: textValue(payload.host),
    sourceDates: textValue(payload.sourceDates),
    freezeDate: payload.freezeDate,
    freezeNote: payload.freezeNote,
    license: textValue(payload.license),
    featureCount: payload.featureCount,
    generatedAt: textValue(payload.generatedAt),
    sites,
    counts: {
      sites: sites.length,
      nj: sites.filter((site) => site.state === 'nj').length,
      de: sites.filter((site) => site.state === 'de').length,
      active: sites.filter((site) => site.status === 'act').length,
      closed: sites.filter((site) => site.status === 'clsd').length,
    },
  };
}

/** Rows in the given states (lowercase codes), in snapshot order. */
export function sitesInStates(sites, states) {
  const wanted = new Set(
    (Array.isArray(states) ? states : []).map((state) =>
      String(state ?? '')
        .trim()
        .toLowerCase(),
    ),
  );
  return (sites ?? []).filter((site) => wanted.has(site.state));
}

/** Case-insensitive substring search on the site name. Empty query finds nothing. */
export function searchHifldSites(sites, query) {
  const needle = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!needle) return [];
  return (sites ?? []).filter((site) =>
    site.name.toLowerCase().includes(needle),
  );
}

/**
 * Map order: home states (NJ, then DE) first, then active sites,
 * then by name. The panel lists every site; the map pins the first
 * 100 of this order.
 */
export function sortHifldSitesForOverlay(sites) {
  const homeRank = (site) => {
    const index = HIFLD_HOME_STATES.indexOf(site.state);
    return index === -1 ? HIFLD_HOME_STATES.length : index;
  };
  return [...(sites ?? [])].sort((a, b) => {
    const home = homeRank(a) - homeRank(b);
    if (home !== 0) return home;
    const active = (a.status === 'act' ? 0 : 1) - (b.status === 'act' ? 0 : 1);
    if (active !== 0) return active;
    return a.name.localeCompare(b.name);
  });
}
