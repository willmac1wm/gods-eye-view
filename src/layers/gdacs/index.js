// src/layers/gdacs/index.js
import * as Cesium from 'cesium';
import {
  GDACS_OVERLAY_COHORT_LIMIT,
  createGdacsOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  GDACS_ATTRIBUTION,
  GDACS_LAYER_ID,
  GDACS_OVERLAY_SOURCE_ID,
  GDACS_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createGdacsSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one GDACS multi-hazard display and its refresh lifecycle.
 *
 * Events come from the GDACS RSS feed via the same-origin server proxy
 * (the feed sends no CORS headers and needs server-side parsing); the
 * layer refreshes every 15 minutes. Pins are capped at the cohort limit
 * (wildfire-heavy days) while the panel lists every event. An empty feed
 * is a valid steady state, shown explicitly — never an empty map presented
 * as "no disasters". Alert levels are GDACS's own, never re-scored here.
 */
export function createGdacsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('GDACS hazards require a snapshot source');
  if (!overlayHost)
    throw new TypeError('GDACS hazards require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _events = [];
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: GDACS_LAYER_ID,
    name: 'GDACS Hazards',
    icon: '🌍',
    source: GDACS_ATTRIBUTION,
    updateInterval: GDACS_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('GDACS hazards layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('gdacs-hazards');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _events = [];
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(GDACS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Gdacs] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(GDACS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(GDACS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GDACS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const snapshot = await source.getSnapshot();
        _events = Array.isArray(snapshot?.events) ? snapshot.events : [];
        _stale = snapshot?.stale === true;
        if (_enabled) {
          overlayHost.setEntries(
            GDACS_OVERLAY_SOURCE_ID,
            createGdacsOverlayEntries({ events: _events }),
            {
              cohortLimit: GDACS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Gdacs] Updated: ${_events.length} event(s)${_stale ? ' (stale)' : ''}`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Gdacs] Fetch error:', e);
        _lastError = e?.message || msg('GDACS source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(GDACS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GDACS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _events = [];
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the GDACS events as plain JSON-safe objects for the analyst
     * query engine. On-demand only — zero per-frame cost, no listeners, no
     * caching. Returns [] while disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || _events.length === 0) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const row of _events) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _events.length,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
