// src/layers/vesselInfo/index.js
import * as Cesium from 'cesium';
import { mapAnalystRecord } from './model.js';
import {
  VESSEL_INFO_LAYER_ID,
  VESSEL_INFO_OVERLAY_SOURCE_ID,
  VESSEL_INFO_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createVesselInfoSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one vessel-background display and its refresh lifecycle.
 *
 * An enrichment panel, not a map layer: there are no pins. The layer
 * owns the background rows for the vessels in the AIS feed (identity
 * fields from AIS + link-outs to Equasis and Maritime Database, where
 * inspection / casualty / company records live). The selected-vessel
 * card on the AIS layer carries the same enrichment as text lines
 * (IMO, reference names) — the overlay is text-only, so the clickable
 * links live in the analyst seam. Background rows recompute whenever
 * the AIS feed refreshes; nothing is fetched from either reference.
 */
export function createVesselInfoLayer({ source, overlayHost } = {}) {
  if (typeof source?.getBackgrounds !== 'function')
    throw new TypeError('Vessel info requires a background source');
  if (!overlayHost) throw new TypeError('Vessel info requires an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _rows = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: VESSEL_INFO_LAYER_ID,
    name: 'Vessel Info',
    icon: '🚢',
    source: 'Own AIS · Equasis · Maritime Database',
    updateInterval: VESSEL_INFO_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Vessel info layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('vessel-info');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(VESSEL_INFO_OVERLAY_SOURCE_ID, false);
      console.log('[Data:VesselInfo] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(VESSEL_INFO_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(VESSEL_INFO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VESSEL_INFO_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const backgrounds = source.getBackgrounds();
        _rows = Array.isArray(backgrounds?.rows) ? backgrounds.rows : [];
        if (_enabled) {
          overlayHost.setEntries(VESSEL_INFO_OVERLAY_SOURCE_ID, []);
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:VesselInfo] Updated: ${_rows.length} vessel background(s)`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:VesselInfo] Fetch error:', e);
        _lastError = e?.message || msg('Vessel info unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(VESSEL_INFO_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(VESSEL_INFO_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _rows = [];
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the vessel backgrounds as plain JSON-safe objects for
     * the analyst query engine. On-demand only — zero per-frame cost,
     * no listeners, no caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || _rows.length === 0) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _rows) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _rows.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
