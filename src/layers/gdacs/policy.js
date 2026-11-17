// src/layers/gdacs/policy.js
// GDACS multi-hazard feed constants. The feed itself is public domain;
// per-event resources are EU CC BY 4.0. Attribution "GDACS" is required
// on the layer. Wildfires dominate the feed by count (205 of 238 items
// on 2026-11-17), so the layer offers a type filter and caps map pins —
// a wildfire-heavy day must not bury the earthquakes and cyclones.
export const GDACS_LAYER_ID = 'gdacs-hazards';
export const GDACS_OVERLAY_SOURCE_ID = 'gdacs-hazards';
export const GDACS_ATTRIBUTION =
  'GDACS — Global Disaster Alert and Coordination System (public domain; per-event resources EU CC BY 4.0)';
export const GDACS_FEED_URL = 'https://www.gdacs.org/xml/rss.xml';
export const GDACS_HOME_URL = 'https://www.gdacs.org/';
/** The provider polls every 15 minutes; the layer refreshes on the same cycle. */
export const GDACS_REFRESH_MS = 15 * 60_000;
/** Map pins are capped; the panel lists every event. */
export const GDACS_OVERLAY_COHORT_LIMIT = 100;
/** GDACS alert levels, in severity order. The level is GDACS's own, not ours. */
export const GDACS_ALERT_LEVELS = Object.freeze(['Green', 'Orange', 'Red']);
export const GDACS_ALERT_RANK = Object.freeze({
  Green: 1,
  Orange: 2,
  Red: 3,
});
export const GDACS_ALERT_ACCENT = Object.freeze({
  Green: '#7cff9b',
  Orange: '#ffb454',
  Red: '#ff6b6b',
});
export const GDACS_ALERT_EMOJI = Object.freeze({
  Green: '🟢',
  Orange: '🟠',
  Red: '🔴',
});
/** Event types the feed carries (EQ/TC/FL/VO/DR/WF/TS as available). */
export const GDACS_EVENT_TYPES = Object.freeze({
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
  TS: 'Tsunami',
});
