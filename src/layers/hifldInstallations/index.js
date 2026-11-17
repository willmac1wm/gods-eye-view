// src/layers/hifldInstallations/index.js
import * as Cesium from 'cesium';
import {
  HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT,
  createHifldOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  HIFLD_INSTALLATIONS_ATTRIBUTION,
  HIFLD_INSTALLATIONS_LAYER_ID,
  HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID,
  HIFLD_INSTALLATIONS_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createHifldInstallationsSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one HIFLD installations display and its refresh lifecycle.
 *
 * The data is a frozen snapshot, not a feed: HIFLD Open shut down
 * August 26, 2025 and the MIRTA source data is dated August 25, 2023,
 * so the layer ships the snapshot bundled and never polls. The panel
 * lists all 744 sites with a state filter; the map pins the first 100
 * (NJ/DE first, then active). getStats().stale is always true by
 * design — the snapshot is frozen, and the layer says so on every
 * view. Coast Guard Training Center Cape May is NOT in MIRTA (DoD-only;
 * USCG is DHS); the in-county CG base is covered by the existing
 * OSM-tile installations layer, and the panel says so.
 */
export function createHifldInstallationsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('HIFLD installations require a snapshot source');
  if (!overlayHost)
    throw new TypeError('HIFLD installations require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: HIFLD_INSTALLATIONS_LAYER_ID,
    name: 'HIFLD Installations',
    icon: '🪖',
    source: HIFLD_INSTALLATIONS_ATTRIBUTION,
    updateInterval: HIFLD_INSTALLATIONS_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('HIFLD installations layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('hifld-installations');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Hifld] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        if (_enabled) {
          overlayHost.setEntries(
            HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID,
            createHifldOverlayEntries({ sites: snapshot?.sites ?? [] }),
            {
              cohortLimit: HIFLD_INSTALLATIONS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Hifld] Updated: ${snapshot?.counts?.sites ?? 0} site(s) (snapshot — not live)`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Hifld] Fetch error:', e);
        _lastError =
          e?.message || msg('HIFLD installations source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(HIFLD_INSTALLATIONS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the MIRTA sites as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost,
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
      for (const site of _snapshot.sites ?? []) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(site, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshot?.counts?.sites ?? 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
        // Frozen by design: the snapshot is never live, so stale is
        // always true and the panel shows the freeze note.
        stale: true,
      };
    },
  };
  return layer;
}
