import {
  HISTORY_AIRCRAFT_API_URL,
  HISTORY_COUNTY_BBOX,
  HISTORY_FEED_API_URL,
  HISTORY_LIMIT,
  HISTORY_STATUS_API_URL,
} from './policy.js';
import {
  normalizeAircraftRow,
  normalizeFeedRow,
  normalizeHistoryStatus,
  normalizeHistoryWindow,
} from './records.js';

/**
 * Same-origin proxy client: fetchImpl-injectable, AbortSignal-aware.
 * Reads the sidecar's own store via the Node proxy (/api/history/*,
 * mounted in server/providers/sidecar.js) — the rows are computed
 * server-side in sidecar/app/history.py, read-only. This client only
 * fetches and validates what comes back; it never invents a position.
 *
 * Attribution (baked into the layer panel): history is Cape Dispatch's
 * own stored ADS-B + feed records; the replay goes back exactly as far
 * as the store does, and the status endpoint says how far that is.
 */
export function createHistorySource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const fetchJson = async (url, { signal } = {}) => {
    signal?.throwIfAborted();
    const response = await fetchImpl(url, { signal, cache: 'no-store' });
    let payload;
    try {
      payload = await response.json();
    } catch {
      /* status below remains authoritative */
    }
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(`History HTTP ${response.status}`);
    return payload;
  };

  return {
    async getStatus({ signal } = {}) {
      const status = normalizeHistoryStatus(
        await fetchJson(HISTORY_STATUS_API_URL, { signal }),
      );
      if (!status) throw new Error('Malformed history status response');
      return status;
    },

    async getWindow({ fromMs, untilMs, signal } = {}) {
      if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs))
        throw new Error('History window needs fromMs and untilMs');
      const bbox = HISTORY_COUNTY_BBOX.join(',');
      const query = new URLSearchParams({
        from: String(fromMs),
        until: String(untilMs),
        bbox,
        limit: String(HISTORY_LIMIT),
      }).toString();
      const [aircraftPayload, feedPayload] = await Promise.all([
        fetchJson(`${HISTORY_AIRCRAFT_API_URL}?${query}`, { signal }),
        fetchJson(`${HISTORY_FEED_API_URL}?${query}`, { signal }),
      ]);
      const aircraft = normalizeHistoryWindow(
        aircraftPayload,
        normalizeAircraftRow,
      );
      const feed = normalizeHistoryWindow(feedPayload, normalizeFeedRow);
      if (!aircraft || !feed)
        throw new Error('Malformed history window response');
      return { aircraft, feed, fromMs, untilMs };
    },
  };
}
