// src/layers/credibility/index.js
import {
  CREDIBILITY_OVERLAY_COHORT_LIMIT,
  createCredibilityOverlayEntries,
  createCredibilitySummaryEntry,
  mapAnalystRecord,
} from './model.js';
import {
  CREDIBILITY_ATTRIBUTION,
  CREDIBILITY_LAYER_ID,
  CREDIBILITY_OVERLAY_SOURCE_ID,
  CREDIBILITY_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createCredibilitySource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one credibility-scoring display and its refresh lifecycle.
 *
 * Scores come from the sidecar (/api/credibility, rules in
 * sidecar/app/credibility.py over stored news_alerts rows) — the layer
 * never scores anything itself. The map shows one label per scored
 * cluster (top 5, most escalated first) plus a county summary label; each
 * label carries the score, the band, the trend, and the top breakdown
 * lines. On a failed refresh the last good scores stay drawn, marked
 * stale. An unscored cluster (no sources) never appears; a blocked-source
 * exclusion is reported on the summary label, never silently dropped.
 */
export function createCredibilityLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Credibility scoring requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Credibility scoring requires an overlay host');
  let _viewer = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: CREDIBILITY_LAYER_ID,
    name: 'Credibility scores',
    icon: '⭐',
    source: CREDIBILITY_ATTRIBUTION,
    updateInterval: CREDIBILITY_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Credibility scoring layer is already initialized');
      _viewer = viewer;
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(CREDIBILITY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Credibility] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      overlayHost.setVisible(CREDIBILITY_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      overlayHost.clearSource(CREDIBILITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CREDIBILITY_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            CREDIBILITY_OVERLAY_SOURCE_ID,
            [
              createCredibilitySummaryEntry({ snapshot }),
              ...createCredibilityOverlayEntries({ snapshot }),
            ],
            {
              cohortLimit: CREDIBILITY_OVERLAY_COHORT_LIMIT + 1,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Credibility] Updated: ${snapshot?.count ?? 0} scored cluster(s)${_stale ? ' (stale)' : ''}`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Credibility] Fetch error:', e);
        _lastError = e?.message || msg('Credibility scores unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(CREDIBILITY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(CREDIBILITY_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the scored clusters as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const cluster of _snapshot.clusters ?? []) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(cluster, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshot?.count ?? 0,
        excludedCount: _snapshot?.excludedCount ?? 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
