// src/layers/vesselInfo/source.js
// Local background reader: no upstream, no fetch. The rows come from
// the AIS layer's analyst seam (vessels.getAnalystRecords),
// normalized to background rows by records.js. The references are
// link-outs only — nothing is fetched from Equasis or Maritime
// Database, ever.
import { normalizeVesselBackground } from './records.js';
import { VESSEL_INFO_ANALYST_LIMIT } from './policy.js';

export function createVesselInfoSource({ vessels = null } = {}) {
  return {
    getBackgrounds({ signal } = {}) {
      signal?.throwIfAborted();
      let records = [];
      try {
        const raw = vessels?.getAnalystRecords?.(VESSEL_INFO_ANALYST_LIMIT);
        records = Array.isArray(raw) ? raw : [];
      } catch {
        records = [];
      }
      const rows = [];
      for (const record of records) {
        const row = normalizeVesselBackground(record);
        if (row) rows.push(row);
      }
      return { rows };
    },
  };
}
