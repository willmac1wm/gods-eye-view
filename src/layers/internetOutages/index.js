// src/layers/internetOutages/index.js
import * as Cesium from 'cesium';
import {
  INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT,
  createInternetOutagesOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import {
  INTERNET_OUTAGES_ATTRIBUTION,
  INTERNET_OUTAGES_LAYER_ID,
  INTERNET_OUTAGES_OVERLAY_SOURCE_ID,
  INTERNET_OUTAGES_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createInternetOutagesSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one internet-outages display and its refresh lifecycle.
 *
 * Outage data comes from IODA (Georgia Tech) via the same-origin server
 * proxy, which polls the US + New Jersey summary scopes (6 h) and the
 * global recent alerts (24 h) every 5 minutes. The layer is panel-first:
 * the map carries a single county-seat anchor label (fuel pattern) —
 * outage entities have no map position of their own. An empty window is
 * a valid steady state ("no NJ outage events in the last 6 h"), shown
 * explicitly — never an empty panel presented as an error. Scores and
 * levels are IODA's own, never re-scored here.
 */
export function createInternetOutagesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Internet outages require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Internet outages require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: INTERNET_OUTAGES_LAYER_ID,
    name: 'Internet Outages',
    icon: '🌐',
    source: INTERNET_OUTAGES_ATTRIBUTION,
    updateInterval: INTERNET_OUTAGES_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Internet outages layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('internet-outages');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(INTERNET_OUTAGES_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Ioda] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(INTERNET_OUTAGES_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(INTERNET_OUTAGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(INTERNET_OUTAGES_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            INTERNET_OUTAGES_OVERLAY_SOURCE_ID,
            [createInternetOutagesOverlayEntry({ snapshot })],
            {
              cohortLimit: INTERNET_OUTAGES_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Ioda] Updated: ${snapshot?.counts?.alerts ?? 0} alert(s), ${snapshot?.counts?.criticalAlerts ?? 0} critical${_stale ? ' (stale)' : ''}`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Ioda] Fetch error:', e);
        _lastError = e?.message || msg('Internet outages source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(INTERNET_OUTAGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(INTERNET_OUTAGES_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the IODA alerts and summaries as plain JSON-safe objects
     * for the analyst query engine. On-demand only — zero per-frame cost,
     * no listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of [
        ...(_snapshot.alerts ?? []),
        ...(_snapshot.usSummary ?? []),
        ...(_snapshot.njSummary ?? []),
      ]) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count:
          (_snapshot?.counts?.alerts ?? 0) +
          (_snapshot?.counts?.usSummary ?? 0) +
          (_snapshot?.counts?.njSummary ?? 0),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
