// src/layers/outbreaks/index.js
import * as Cesium from 'cesium';
import {
  OUTBREAKS_OVERLAY_COHORT_LIMIT,
  createOutbreaksOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import {
  OUTBREAKS_ATTRIBUTION,
  OUTBREAKS_LAYER_ID,
  OUTBREAKS_OVERLAY_SOURCE_ID,
  OUTBREAKS_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createOutbreaksSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one outbreaks display and its refresh lifecycle.
 *
 * Data comes from CDC ArboNET (West Nile / arbovirus county + state
 * tables) and WHO Disease Outbreak News via the same-origin server
 * proxy, which polls both once per day. The layer is panel-first: the
 * map carries a single county-seat anchor label (fuel pattern) — the
 * CDC county table is a table, not pins, and WHO DONs are international
 * headlines with no map position. Counts are CDC/WHO's own, shown with
 * their as-of date; a Cape May row of zero human cases is a real result
 * ("non-human activity"), shown explicitly — never an empty panel
 * presented as an error. The two halves stay source-labeled everywhere.
 */
export function createOutbreaksLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Outbreaks require a snapshot source');
  if (!overlayHost) throw new TypeError('Outbreaks require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: OUTBREAKS_LAYER_ID,
    name: 'Outbreaks',
    icon: '🦟',
    source: OUTBREAKS_ATTRIBUTION,
    updateInterval: OUTBREAKS_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Outbreaks layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('outbreaks');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(OUTBREAKS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Outbreaks] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(OUTBREAKS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(OUTBREAKS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OUTBREAKS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            OUTBREAKS_OVERLAY_SOURCE_ID,
            [createOutbreaksOverlayEntry({ snapshot })],
            {
              cohortLimit: OUTBREAKS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Outbreaks] Updated: NJ ${snapshot?.counts?.njCases ?? '—'} WNV case(s), ${snapshot?.counts?.don ?? 0} WHO alert(s)${_stale ? ' (stale)' : ''}`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Outbreaks] Fetch error:', e);
        _lastError = e?.message || msg('Outbreaks source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(OUTBREAKS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OUTBREAKS_OVERLAY_SOURCE_ID, false);
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
     * Snapshot the ArboNET rows and WHO DON items as plain JSON-safe
     * objects for the analyst query engine. On-demand only — zero
     * per-frame cost, no listeners, no caching. Returns [] while
     * disabled or empty.
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
        ...(_snapshot.arbonet?.states ?? []),
        ...(_snapshot.arbonet?.njCounties ?? []),
        ...(_snapshot.don?.items ?? []),
      ]) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count:
          (_snapshot?.counts?.states ?? 0) +
          (_snapshot?.counts?.njCounties ?? 0) +
          (_snapshot?.counts?.don ?? 0),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
