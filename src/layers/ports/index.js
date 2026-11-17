// src/layers/ports/index.js
import * as Cesium from 'cesium';
import {
  PORTS_OVERLAY_COHORT_LIMIT,
  createPortsOverlayEntries,
  mapAnalystRecord,
} from './model.js';
import {
  PORTS_LAYER_ID,
  PORTS_OVERLAY_SOURCE_ID,
  PORTS_REFRESH_MS,
} from './policy.js';
export * from './model.js';
export { createPortsSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one ports + chokepoints display and its refresh lifecycle.
 * The data is a static hand-curated snapshot (NGA World Port Index
 * particulars, public domain) — ports are slow-moving and the bulk
 * WPI download is unreachable today (theportindex.online/data 404s;
 * msi.nga.mil HTTP 503), so there is no live poll and no upstream
 * to fail. A snapshot with zero usable rows reports "Ports
 * unavailable" — never an empty map presented as "no ports".
 */
export function createPortsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Ports require a snapshot source');
  if (!overlayHost) throw new TypeError('Ports require an overlay host');
  let _viewer = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: PORTS_LAYER_ID,
    name: 'Ports',
    icon: '⚓',
    source: 'NGA World Port Index (public domain)',
    updateInterval: PORTS_REFRESH_MS,

    init(viewer) {
      if (_viewer) throw new Error('Ports layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('ports');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(PORTS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Ports] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(PORTS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(PORTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PORTS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      try {
        const snapshot = source.getSnapshot();
        if (
          !snapshot ||
          (snapshot.ports.length === 0 && snapshot.chokepoints.length === 0)
        ) {
          _lastError = msg('Ports unavailable');
          return false;
        }
        _snapshot = snapshot;
        if (_enabled) {
          overlayHost.setEntries(
            PORTS_OVERLAY_SOURCE_ID,
            createPortsOverlayEntries({
              ports: snapshot.ports,
              chokepoints: snapshot.chokepoints,
            }),
            {
              cohortLimit: PORTS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Ports] Updated: ${snapshot.ports.length} port(s), ${snapshot.chokepoints.length} chokepoint(s)`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Ports] Fetch error:', e);
        _lastError = e?.message || msg('Ports unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      overlayHost.clearSource(PORTS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PORTS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the ports and chokepoints as plain JSON-safe objects
     * for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while disabled or
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
      for (const row of [..._snapshot.ports, ..._snapshot.chokepoints]) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshot
          ? _snapshot.ports.length + _snapshot.chokepoints.length
          : 0,
        ports: _snapshot?.ports.length ?? 0,
        chokepoints: _snapshot?.chokepoints.length ?? 0,
        version: _snapshot?.version ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
