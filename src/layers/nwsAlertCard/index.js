import * as Cesium from 'cesium';
import {
  NWS_ALERT_CARD_OVERLAY_SOURCE_ID,
  NWS_ALERT_CARD_OVERLAY_COHORT_LIMIT,
  createNwsAlertCardOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { LAYER_ID, NWS_ALERT_CARD_REFRESH_MS } from './policy.js';
export * from './model.js';
export { createNwsAlertCardSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one NWS alert-card display and its refresh lifecycle. The card
 * re-presents the existing /api/nws feed in plain English — no new
 * fetch, no new provider. Zero active alerts is the steady state: the
 * label says "No active NWS alerts", never a blank card.
 */
export function createNwsAlertCardLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('NWS alert card requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('NWS alert card requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'NWS alerts',
    icon: '⚠',
    source: 'National Weather Service',
    updateInterval: NWS_ALERT_CARD_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('NWS alert card layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('nws-alert-card');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(NWS_ALERT_CARD_OVERLAY_SOURCE_ID, false);
      console.log('[Data:NwsAlertCard] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(NWS_ALERT_CARD_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(NWS_ALERT_CARD_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NWS_ALERT_CARD_OVERLAY_SOURCE_ID, false);
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
            NWS_ALERT_CARD_OVERLAY_SOURCE_ID,
            [createNwsAlertCardOverlayEntry({ snapshot })].slice(
              0,
              NWS_ALERT_CARD_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: NWS_ALERT_CARD_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:NwsAlertCard] Updated: ${snapshot.alerts.length} active alerts`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:NwsAlertCard] Fetch error:', e);
        _lastError = e?.message || msg('NWS alerts source unavailable');
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
      overlayHost.clearSource(NWS_ALERT_CARD_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(NWS_ALERT_CARD_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's active alerts as plain JSON-safe objects for
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
      for (const alert of _snapshot.alerts) {
        if (result.length >= limit) break;
        result.push(mapAnalystRecord(alert, result.length));
      }
      return result;
    },

    getStats() {
      return {
        count: _snapshot ? _snapshot.alerts.length : 0,
        events: _snapshot ? _snapshot.alerts.map((alert) => alert.event) : [],
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
