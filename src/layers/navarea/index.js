// src/layers/navarea/index.js
import * as Cesium from 'cesium';
import {
  NAVAREA_OVERLAY_COHORT_LIMIT,
  createNavareaOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  NAVAREA_LAYER_ID,
  NAVAREA_OVERLAY_SOURCE_ID,
  NAVAREA_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createNavareaSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one NAVAREA warnings display and its refresh lifecycle.
 * Bulletins are rebuilt daily, so the layer polls once a day; the
 * provider caches 24 hours. On upstream failure the layer serves the
 * last cached bulletin with its date, labeled stale; with no cache it
 * shows "NAVAREA warnings unavailable" with a link to the portal —
 * never an empty map presented as "no warnings". Zero warnings in our
 * box is normal (most NAVAREA IV warnings are Caribbean/Gulf) — the
 * stats say so explicitly.
 *
 * BUILD BLOCKER (verified 2026-11-17): msi.nga.mil returns HTTP 503
 * from both this VM and Legion, so the provider cannot fetch live
 * bulletins today. The layer is complete and lights up when NGA
 * serves again; until then it reports unavailable, per the spec.
 */
export function createNavareaLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('NAVAREA warnings require a snapshot source');
  if (!overlayHost)
    throw new TypeError('NAVAREA warnings require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: NAVAREA_LAYER_ID,
    name: 'NAVAREA Warnings',
    icon: '⚠',
    source: 'NGA Maritime Safety Information',
    updateInterval: NAVAREA_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('NAVAREA warnings layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('navarea-warnings');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(NAVAREA_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Navarea] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(NAVAREA_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(NAVAREA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NAVAREA_OVERLAY_SOURCE_ID, false);
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
            NAVAREA_OVERLAY_SOURCE_ID,
            createNavareaOverlayEntries({ warnings: snapshot.warnings }),
            {
              cohortLimit: NAVAREA_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Navarea] Updated: ${snapshot.warnings.length} warning(s) in force (${snapshot.inForceCount} listed)`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Navarea] Fetch error:', e);
        _lastError = e?.message || msg('NAVAREA warnings unavailable');
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
      overlayHost.clearSource(NAVAREA_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NAVAREA_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the in-force warnings as plain JSON-safe objects for
     * the analyst query engine. On-demand only — zero per-frame cost,
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
      for (const warning of _snapshot.warnings) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(warning, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshot ? _snapshot.warnings.length : 0,
        inForceCount: _snapshot?.inForceCount ?? null,
        bulletinDate: _snapshot?.bulletinDate ?? null,
        stale: _snapshot?.stale === true,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
