import * as Cesium from 'cesium';
import {
  RADIATION_OVERLAY_SOURCE_ID,
  RADIATION_OVERLAY_COHORT_LIMIT,
  createRadiationOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { LAYER_ID, RADIATION_REFRESH_MS } from './policy.js';
export * from './model.js';
export { createRadiationSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one radiation display and its refresh lifecycle. Readings are
 * hourly, so the layer polls once an hour; the provider caches 60
 * minutes. The card shows regional background from the nearest EPA
 * monitors — there is no monitor in the county, and the label says so.
 */
export function createRadiationLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Radiation requires a snapshot source');
  if (!overlayHost) throw new TypeError('Radiation requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'Radiation',
    icon: '☢️',
    source: 'EPA RadNet · Safecast',
    updateInterval: RADIATION_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Radiation layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('radiation');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Radiation] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(RADIATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
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
            RADIATION_OVERLAY_SOURCE_ID,
            [createRadiationOverlayEntry({ snapshot })].slice(
              0,
              RADIATION_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: RADIATION_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Radiation] Updated: ${snapshot.monitors.map((m) => `${m.name} ${m.doseRateNSvH} nSv/h`).join(', ')}`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Radiation] Fetch error:', e);
        _lastError = e?.message || msg('Radiation source unavailable');
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
      overlayHost.clearSource(RADIATION_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(RADIATION_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's monitor readings as plain JSON-safe objects
     * for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while the layer is
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
      for (const monitor of _snapshot.monitors) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(monitor, result.length));
      }
      return result;
    },

    getStats() {
      const first = _snapshot?.monitors?.[0] ?? null;
      return {
        count: _snapshot ? _snapshot.monitors.length : 0,
        nearestMonitor: first?.name ?? null,
        doseRateNSvH: first?.doseRateNSvH ?? null,
        safecastValue: _snapshot?.safecast?.value ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
