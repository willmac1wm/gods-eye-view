import * as Cesium from 'cesium';
import {
  DROUGHT_OVERLAY_SOURCE_ID,
  DROUGHT_OVERLAY_COHORT_LIMIT,
  createDroughtOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { DROUGHT_CATEGORIES } from './records.js';
import { LAYER_ID, DROUGHT_REFRESH_MS } from './policy.js';
export * from './model.js';
export { createDroughtSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one drought display and its refresh lifecycle. The map only
 * changes on Thursdays, so the layer polls once a day and the provider
 * caches 24 hours. The label shows the worst category touching the
 * county (or the all-clear line when the county is in no polygon).
 */
export function createDroughtLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Drought requires a snapshot source');
  if (!overlayHost) throw new TypeError('Drought requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'Drought',
    icon: '💧',
    source: 'U.S. Drought Monitor',
    updateInterval: DROUGHT_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Drought layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('drought');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(DROUGHT_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Drought] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(DROUGHT_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(DROUGHT_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DROUGHT_OVERLAY_SOURCE_ID, false);
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
            DROUGHT_OVERLAY_SOURCE_ID,
            [createDroughtOverlayEntry({ snapshot })].slice(
              0,
              DROUGHT_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: DROUGHT_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Drought] Updated: ${snapshot.category == null ? 'no drought' : DROUGHT_CATEGORIES[snapshot.category].code}`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Drought] Fetch error:', e);
        _lastError = e?.message || msg('Drought source unavailable');
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
      overlayHost.clearSource(DROUGHT_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(DROUGHT_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's county drought reading as a plain JSON-safe
     * object for the analyst query engine. On-demand only — zero
     * per-frame cost, no listeners, no caching. Returns [] while the
     * layer is disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      if (limit < 1) return [];
      const info =
        _snapshot.category != null
          ? DROUGHT_CATEGORIES[_snapshot.category]
          : null;
      return [
        mapAnalystRecord(
          {
            id: 'drought-county',
            category: _snapshot.category,
            code: info?.code ?? null,
            name: info?.name ?? null,
            releasedAt: _snapshot.releasedAt,
          },
          0,
        ),
      ];
    },

    getStats() {
      return {
        count: _snapshot ? 1 : 0,
        category: _snapshot?.category ?? null,
        code:
          _snapshot?.category != null
            ? DROUGHT_CATEGORIES[_snapshot.category].code
            : null,
        releasedAt: _snapshot?.releasedAt ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
