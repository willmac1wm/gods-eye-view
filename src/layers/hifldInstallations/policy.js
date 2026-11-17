// src/layers/hifldInstallations/policy.js
// HIFLD Next MIRTA DoD Sites — Points, frozen snapshot constants.
// HIFLD Open shut down August 26, 2025; the source data is dated
// August 25, 2023. This layer is a STATIC snapshot — never presented
// as live. The snapshot ships bundled in the repo (mirtaSnapshot.json,
// built by scripts/generate-hifld-snapshot.mjs) and refreshes only
// when a maintainer re-verifies it by hand.
// Coast Guard Training Center Cape May is NOT in MIRTA (DoD-only;
// USCG is DHS) — the in-county CG base is covered by the existing
// OSM-tile installations layer; the panel says so.
export const HIFLD_INSTALLATIONS_LAYER_ID = 'hifld-installations';
export const HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID = 'hifld-installations';
export const HIFLD_INSTALLATIONS_ATTRIBUTION =
  'HIFLD Next / MIRTA DoD Sites – Points (snapshot — not live)';
export const HIFLD_SNAPSHOT_SOURCE = 'HIFLD Next / MIRTA DoD Sites – Points';
export const HIFLD_SNAPSHOT_PRODUCER = 'DoD DISDI';
export const HIFLD_SNAPSHOT_HOST = 'HIFLD Next (Data Rescue Project snapshot)';
export const HIFLD_SNAPSHOT_SOURCE_DATES = '2023-08-25';
export const HIFLD_SNAPSHOT_FREEZE_DATE = '2025-08-26';
export const HIFLD_FREEZE_NOTE =
  'HIFLD snapshot — source data August 25, 2023; HIFLD Open shut down August 26, 2025; not live.';
export const HIFLD_SNAPSHOT_LICENSE =
  'other (U.S. federal public domain origin)';
export const HIFLD_SNAPSHOT_FEATURE_COUNT = 744;
/** Static snapshot — re-publish once a day at most; nothing upstream to poll. */
export const HIFLD_INSTALLATIONS_REFRESH_MS = 86_400_000;
/** Map pins cap (NJ/DE first, then active); the panel lists all 744. */
export const HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT = 100;
/** States pinned first on the map. */
export const HIFLD_HOME_STATES = Object.freeze(['nj', 'de']);
