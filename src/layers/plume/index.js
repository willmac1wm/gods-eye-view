// src/layers/plume/index.js
import * as Cesium from 'cesium';
import {
  PLUME_OVERLAY_COHORT_LIMIT,
  createFalloutPlumeOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import {
  PLUME_ATTRIBUTION,
  PLUME_LAYER_ID,
  PLUME_OVERLAY_SOURCE_ID,
  PLUME_REFRESH_MS,
} from './policy.js';
import { createPlumeRendering } from './rendering.js';
export * from './model.js';
export { createFalloutPlumeSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one fallout-plume display and its refresh lifecycle.
 *
 * Winds come from the NWS hourly forecast at the Salem/Hope Creek grid
 * cell (PHI/40,55), fetched direct from api.weather.gov (CORS `*`,
 * verified 2026-11-17 — no server provider). The plume is advection
 * only: the centroid steps hour by hour downwind, inside a fixed 15°
 * cone, with a 10-mile EPZ reference circle. It is NEVER a HYSPLIT run
 * — the anchor label carries "Advection only — not a HYSPLIT run" and
 * "Planning aid only — follow official guidance" on every view, and the
 * geometry is drawn by rendering.js (cyclones pattern) while the label
 * goes through the overlay host. A calm hour pools in place; a missing
 * wind ends the path early (stoppedEarly) and the stale label says so.
 * On a failed refresh the last good plume stays drawn, marked stale.
 */
export function createFalloutPlumeLayer({
  source,
  overlayHost,
  renderingFactory = createPlumeRendering,
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Fallout plume requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Fallout plume requires an overlay host');
  let _viewer = null;
  let _rendering = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _stale = false;
  let _enabled = false;

  const layer = {
    id: PLUME_LAYER_ID,
    name: 'Fallout Plume',
    icon: '☢️',
    source: PLUME_ATTRIBUTION,
    updateInterval: PLUME_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Fallout plume layer is already initialized');
      _viewer = viewer;
      _rendering = renderingFactory({ viewer, cesium: Cesium });
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
      _enabled = false;
      overlayHost.setVisible(PLUME_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Plume] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      _rendering?.setVisible(true);
      overlayHost.setVisible(PLUME_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _enabled = false;
      _rendering?.setVisible(false);
      overlayHost.clearSource(PLUME_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PLUME_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_rendering) return false;
      try {
        const snapshot = await source.getSnapshot();
        _snapshot = snapshot;
        _stale = snapshot?.stale === true;
        if (_enabled) {
          _rendering.setSnapshot(snapshot);
          _rendering.setVisible(true);
          overlayHost.setEntries(
            PLUME_OVERLAY_SOURCE_ID,
            [createFalloutPlumeOverlayEntry({ snapshot })],
            {
              cohortLimit: PLUME_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Plume] Updated: ${snapshot?.counts?.nodes ?? 0} path node(s), ${Math.round(snapshot?.distanceMi ?? 0)} mi in 24 h${_stale ? ' (stale)' : ''}`,
        );
        return true;
      } catch (e) {
        console.warn('[Data:Plume] Fetch error:', e);
        _lastError = e?.message || msg('Fallout plume source unavailable');
        return false;
      }
    },

    destroy(viewer = _viewer) {
      _viewer = null;
      _enabled = false;
      _rendering?.destroy();
      _rendering = null;
      overlayHost.clearSource(PLUME_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(PLUME_OVERLAY_SOURCE_ID, false);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _stale = false;
    },

    /**
     * Snapshot the plume winds and path nodes as plain JSON-safe objects
     * for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while disabled or empty.
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
        ...(_snapshot.winds ?? []).map((wind) => ({ kind: 'wind', ...wind })),
        ...(_snapshot.path ?? []).map((node) => ({ kind: 'node', ...node })),
      ]) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(row, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count:
          (_snapshot?.counts?.winds ?? 0) + (_snapshot?.counts?.nodes ?? 0),
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}
