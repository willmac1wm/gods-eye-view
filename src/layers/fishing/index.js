// src/layers/fishing/index.js
import * as Cesium from 'cesium';
import {
  FISHING_OVERLAY_COHORT_LIMIT,
  createFishingOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  FISHING_LAYER_ID,
  FISHING_OVERLAY_SOURCE_ID,
  FISHING_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createFishingSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one fishing-vessel presence display and its refresh lifecycle.
 *
 * Presence comes from the AIS feed alone (ship type 30, in the county /
 * Delaware Bay box) and recomputes whenever the feed refreshes — no
 * separate poller, no upstream. The layer shows presence, never
 * "fishing effort": a fishing vessel underway is not necessarily
 * fishing. Apparent fishing effort lives on Global Fishing Watch's map
 * (link-out; the v3 API is key-gated, v2 wires it behind William's
 * free token). Zero fishing vessels in the box is a real steady state,
 * shown explicitly — never an empty map presented as "no fishing".
 */
export function createFishingLayer({ source, overlayHost } = {}) {
  if (typeof source?.getPresence !== 'function')
    throw new TypeError('Fishing activity requires a presence source');
  if (!overlayHost)
    throw new TypeError('Fishing activity requires an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _vessels = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: FISHING_LAYER_ID,
    name: 'Fishing Activity',
    icon: '🎣',
    source: 'Own AIS · Global Fishing Watch (CC BY-NC 4.0)',
    updateInterval: FISHING_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Fishing activity layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('fishing-activity');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _vessels = [];
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(FISHING_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Fishing] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(FISHING_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(FISHING_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FISHING_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const presence = source.getPresence();
        _vessels = Array.isArray(presence?.vessels) ? presence.vessels : [];
        if (_enabled) {
          overlayHost.setEntries(
            FISHING_OVERLAY_SOURCE_ID,
            createFishingOverlayEntries({ vessels: _vessels }),
            {
              cohortLimit: FISHING_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Fishing] Updated: ${_vessels.length} fishing vessel(s) present`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Fishing] Fetch error:', e);
        _lastError = e?.message || msg('Fishing source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(FISHING_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FISHING_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _vessels = [];
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the fishing vessels present as plain JSON-safe objects
     * for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while disabled or
     * empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || _vessels.length === 0) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _vessels) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _vessels.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
