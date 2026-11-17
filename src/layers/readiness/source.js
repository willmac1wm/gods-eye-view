import { computeDrivers } from './records.js';

/**
 * Live-state driver source: fetchImpl-free, readLayers-driven (the D4
 * county-risk precedent). The catalog hands it lazy accessors to the
 * already-constructed driver layers (NWS alerts, tides, outages, drought,
 * space weather); the source reads their analyst records + stats and
 * computes the six readiness drivers. A layer that is disabled, never
 * refreshed, or throwing reads as missing — its driver falls back to the
 * baseline, labeled unavailable, never counted as "all clear" and never
 * as "due now". No network call: the checklists are static (bundled
 * checklists.json) and the drivers come from layers that already fetch.
 *
 * Attribution (baked into the layer panel): checklists curated from
 * Ready.gov / FEMA (public domain); urgency driven by live layer states.
 */
function safeRecords(layer) {
  try {
    const records = layer?.getAnalystRecords?.();
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function safeStats(layer) {
  try {
    const stats = layer?.getStats?.();
    return stats && typeof stats === 'object' ? stats : null;
  } catch {
    return null;
  }
}

/** A driver layer counts as live when it answers records or stats at all. */
function layerAvailable(layer) {
  if (!layer) return false;
  try {
    if (Array.isArray(layer?.getAnalystRecords?.())) return true;
  } catch {
    /* fall through to the stats check */
  }
  return safeStats(layer) !== null;
}

export function createReadinessSource({ readLayers = () => ({}) } = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const layers = readLayers() ?? {};
      const inputs = {
        nwsRecords: safeRecords(layers.nwsAlertCard),
        tideRecords: safeRecords(layers.tides),
        outageRecords: safeRecords(layers.outages),
        droughtRecords: safeRecords(layers.drought),
        spaceRecords: safeRecords(layers.spaceWeather),
      };
      const unavailable = [];
      if (!layerAvailable(layers.nwsAlertCard)) {
        unavailable.push('nws');
      }
      if (!layerAvailable(layers.tides)) unavailable.push('tides');
      if (!layerAvailable(layers.outages)) unavailable.push('outages');
      if (!layerAvailable(layers.drought)) unavailable.push('drought');
      if (!layerAvailable(layers.spaceWeather)) unavailable.push('space');
      return {
        drivers: computeDrivers(inputs),
        unavailable,
        fetchedAt: Date.now(),
        stale: false,
      };
    },
  };
}
