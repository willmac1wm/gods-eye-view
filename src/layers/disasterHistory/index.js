import * as Cesium from 'cesium';
import {
  DISASTER_HISTORY_OVERLAY_SOURCE_ID,
  DISASTER_HISTORY_OVERLAY_COHORT_LIMIT,
  createDisasterHistoryOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { DISASTER_HISTORY_REFRESH_MS, LAYER_ID } from './policy.js';
export * from './model.js';
export { createDisasterHistorySource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one disaster-history display and its refresh lifecycle. History is
 * not a live feed: the OpenFEMA half refreshes at most once a day and the
 * Storm Events half is a static snapshot in the repo. One overlay label
 * over the county seat carries the headline count; the timeline lives in
 * the panel, and one analyst record per declaration feeds the query engine.
 */
export function createDisasterLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Disaster history requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Disaster history requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'Disaster history',
    icon: '🌀',
    source: 'FEMA OpenFEMA · NOAA NCEI',
    updateInterval: DISASTER_HISTORY_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Disaster history layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('disaster-history');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(DISASTER_HISTORY_OVERLAY_SOURCE_ID, false);
      console.log('[Data:DisasterHistory] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(DISASTER_HISTORY_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(DISASTER_HISTORY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DISASTER_HISTORY_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        _snapshot = snapshot;
        if (_enabled) {
          overlayHost.setEntries(
            DISASTER_HISTORY_OVERLAY_SOURCE_ID,
            [createDisasterHistoryOverlayEntry({ snapshot })].slice(
              0,
              DISASTER_HISTORY_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: DISASTER_HISTORY_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:DisasterHistory] Updated: ${snapshot.declarationCount} declarations`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:DisasterHistory] Fetch error:', e);
        _lastError = e?.message || msg('Disaster history source unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(DISASTER_HISTORY_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DISASTER_HISTORY_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's declarations as plain JSON-safe objects for
     * the analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while the layer is disabled or
     * empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const declaration of _snapshot.declarations) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(declaration, result.length));
      }
      return result;
    },

    getStats() {
      const latest = _snapshot?.declarations?.[0] ?? null;
      const earliest = _snapshot?.declarations?.at(-1) ?? null;
      return {
        count: _snapshot ? _snapshot.declarations.length : 0,
        declarationCount: _snapshot?.declarationCount ?? null,
        latestDeclaration: latest?.id ?? null,
        latestIncidentType: latest?.incidentType ?? null,
        earliestDeclaration: earliest?.id ?? null,
        stormEventYears: _snapshot
          ? Object.keys(_snapshot.stormEvents.years).sort()
          : [],
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
