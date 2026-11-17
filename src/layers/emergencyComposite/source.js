// A source module (no browser globals, see check:boundaries), so no i18n
// import: failures stay English here and the layer translates them on show.
const msg = (text) => text;

import {
  EMERGENCY_COMPOSITE_IPAWS_LIMIT,
  EMERGENCY_COMPOSITE_IPAWS_ROUTE,
} from './policy.js';
import { assembleComposite, validateSnapshot } from './records.js';

/** A layer that is disabled, never refreshed, or throws reads as missing — never as zero, never a crash (the D4 inputs.js pattern). */
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

/**
 * Acquire the emergency composite: the NWS, CAD and plume layer states
 * through lazy accessors, plus the newest IPAWS-sourced alerts from the
 * sidecar (`GET /api/alerts/ipaws` — slim rows, no report_md). Every input
 * is read safely: a quadrant whose source is down is unavailable in the
 * snapshot, never a crash and never an empty quadrant presented as
 * "all clear". The IPAWS fetch failing only takes down the IPAWS half of
 * the Hazmat quadrant; the rest of the composite still assembles.
 * @param {object} options
 * @param {Function} options.readLayers Lazy accessor for the other layers.
 * @param {Function} options.fetchImpl Injected request function.
 * @param {string} options.ipawsRoute Sidecar IPAWS route (default /api/alerts/ipaws).
 * @returns {{getSnapshot: Function}}
 */
export function createEmergencyCompositeSource({
  readLayers,
  fetchImpl = (...args) => globalThis.fetch(...args),
  ipawsRoute = EMERGENCY_COMPOSITE_IPAWS_ROUTE,
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      let layers = null;
      try {
        layers = readLayers?.() ?? null;
      } catch {
        layers = null;
      }
      const nwsRecords = safeRecords(layers?.nwsAlertCard);
      const nwsStats = safeStats(layers?.nwsAlertCard);
      const cadStats = safeStats(layers?.capeCad);
      const plumeStats = safeStats(layers?.plume);

      let ipawsItems = [];
      let ipawsAvailable = false;
      try {
        const response = await fetchImpl(
          `${ipawsRoute}?limit=${EMERGENCY_COMPOSITE_IPAWS_LIMIT}`,
          { signal, headers: { Accept: 'application/json' } },
        );
        const payload = await response.json();
        signal?.throwIfAborted();
        if (response.ok && Array.isArray(payload?.alerts)) {
          ipawsItems = payload.alerts;
          ipawsAvailable = true;
        }
      } catch {
        // The IPAWS half of the Hazmat quadrant is unavailable; the rest
        // of the composite still assembles.
        ipawsItems = [];
        ipawsAvailable = false;
      }

      const snapshot = assembleComposite(
        {
          nwsRecords,
          nwsStats,
          cadStats,
          plumeStats,
          ipawsItems,
          ipawsAvailable,
        },
        Date.now(),
      );
      const errors = validateSnapshot(snapshot);
      if (errors.length)
        throw new Error(`Invalid snapshot: ${errors.join('; ')}`);
      return snapshot;
    },
  };
}
