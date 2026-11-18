/**
 * Layers left out of the Data Layers list. Each one either repeats a listed
 * layer (the listed one is the one that works), does not work for this site's
 * audience, or is an experiment. The code stays; nothing here is deleted.
 *
 * A hidden layer that is already on (an old share link, a voice command) still
 * gets a row, so it can always be switched off. The Managers and Local layer
 * defaults never switch a hidden layer on.
 *
 * Audit behind this list (live site, 2026-11-17): every layer was switched on
 * alone and checked for an error, an empty result and the age of its data.
 */
const HIDDEN = Object.freeze([
  // Duplicates of a listed layer.
  'cape-nws', // NWS Alerts
  'nws-alert-card', // NWS Alerts
  'cape-outages', // Power Outages
  'outages', // Power Outages (MassOutage feed answers malformed)
  'cape-buoys', // Marine Buoys
  'cape-airports', // Airport Weather
  'tides', // Tide & Flood Gauges
  'cape-flood', // Tide & Flood Gauges
  'cape-whales', // Right Whale Speed Zones
  'cape-tomtom', // Traffic Incidents
  'cape-cameras', // CCTV carries the Cape camera packs
  'surveillance-cameras', // ALPR Cameras and CCTV; Overpass is unreliable
  'gnss-integrity', // GPSJam (Daily); rate limited
  'military-installations', // HIFLD Installations
  // Off-topic for a Cape May County desk, or not working.
  'ski-pistes',
  'sanctions-watch',
  's2-ghostmaps',
  'satellite-verification',
  'alpr-avoidance-routing',
  'vessel-info',
  'emergency-composite',
  'ai-situation',
  'radio', // world internet radio; scanner audio is Dispatch radio
  'fishing-activity',
  'local-datacenters',
  'navarea-warnings',
  'aprs-weather', // needs an APRS key
]);

const HIDDEN_SET = new Set(HIDDEN);

/** Every hidden layer id, in the order above. */
export const PANEL_HIDDEN_LAYER_IDS = HIDDEN;

/** Whether `layerId` is left out of the Data Layers list. */
export function isPanelHiddenLayer(layerId) {
  return HIDDEN_SET.has(layerId);
}
