// D4 county risk score — layer policy (presentation constants only).
// The numbers themselves (weights, rule table, band edges) live in
// src/data/countyRisk.js, the single source of truth; this file only
// holds refresh cadence, overlay ids, and attribution strings.
export const COUNTY_RISK_LAYER_ID = 'county-risk';
export const COUNTY_RISK_REFRESH_MS = 5 * 60 * 1000;
export const COUNTY_RISK_OVERLAY_SOURCE_ID = 'county-risk';
export const COUNTY_RISK_OVERLAY_COHORT_LIMIT = 6; // summary + 5 components
export const COUNTY_RISK_LIGHTNING_API_URL = '/api/lightning/status';
export const COUNTY_RISK_ATTRIBUTION =
  'Cape Dispatch rules over live layer states — NWS, NOAA CO-OPS tides, Atlantic City Electric outages, GDACS, USGS, FIRMS, NOAA SWPC, GOES-19 GLM';

// Band accent colors for the overlay labels and the row-controls legend.
export const COUNTY_RISK_BAND_COLORS = {
  Severe: '#ff5252',
  High: '#ff9800',
  Elevated: '#ffd54f',
  Guarded: '#64b5f6',
  Low: '#66bb6a',
};

export const COUNTY_RISK_COMPONENT_LABELS = {
  weather: 'Weather',
  power: 'Power',
  hazards: 'Hazards',
  lightning: 'Lightning',
  space: 'Space weather',
};
