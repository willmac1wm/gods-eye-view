// src/layers/fishing/source.js
// Local presence reader: no upstream, no fetch. The layer's records
// come from the AIS layer's analyst seam (vessels.getAnalystRecords),
// filtered to fishing vessels in the county box by records.js. The
// GFW half is a link-out in v1 — its v3 API is key-gated, so there is
// no provider to call until William's free token exists (v2).
import { buildFishingLinks, normalizeFishingRecord } from './records.js';

export function createFishingSource({ vessels = null } = {}) {
  return {
    getPresence({ signal } = {}) {
      signal?.throwIfAborted();
      let records = [];
      try {
        const raw = vessels?.getAnalystRecords?.();
        records = Array.isArray(raw) ? raw : [];
      } catch {
        records = [];
      }
      const fishing = [];
      for (const record of records) {
        const row = normalizeFishingRecord(record);
        if (row) fishing.push(row);
      }
      return { vessels: fishing, links: buildFishingLinks() };
    },
  };
}
