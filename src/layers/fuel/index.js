import * as Cesium from 'cesium';
import {
  FUEL_OVERLAY_SOURCE_ID,
  FUEL_OVERLAY_COHORT_LIMIT,
  createFuelOverlayEntry,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createEiaFuelSource, EiaKeyMissingError } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one fuel-price display and its refresh lifecycle. Fuel prices have
 * no map pins — the layer is a county price ticker (one overlay label)
 * plus analyst records, one per series. Polls every 6 hours: EIA
 * publishes gasoline/diesel Monday afternoon ET and heating oil
 * Wednesdays after 1:00 PM ET (Oct–Mar), so faster polling gains nothing.
 */
export function createFuelLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Fuel prices require a snapshot source');
  if (!overlayHost) throw new TypeError('Fuel prices require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'fuel-prices',
    name: 'Fuel Prices',
    icon: '⛽',
    source: 'U.S. EIA',
    updateInterval: 21600000,

    init(viewer) {
      if (_viewer) throw new Error('Fuel layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('fuel-prices');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Fuel] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(FUEL_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
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
            FUEL_OVERLAY_SOURCE_ID,
            [createFuelOverlayEntry({ snapshot })].slice(
              0,
              FUEL_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: FUEL_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Fuel] Updated: week of ${snapshot.latestWeek ?? 'unknown'}`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Fuel] Fetch error:', e);
        _lastError = e?.message || msg('Fuel source unavailable');
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
      overlayHost.clearSource(FUEL_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FUEL_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's latest weekly price per series as plain
     * JSON-safe objects for the analyst query engine. On-demand only —
     * zero per-frame cost, no listeners, no caching. Returns [] while the
     * layer is disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled || !_snapshot) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const series of Object.values(_snapshot.series)) {
        if (result.length >= limit) break;
        const latest = series.values[0];
        if (!latest) continue;
        result.push(
          mapAnalystRecord(
            {
              seriesId: series.seriesId,
              label: series.label,
              product: series.product,
              area: series.area,
              proxy: series.proxy,
              value: latest.value,
              unit: series.unit,
              period: latest.period,
            },
            result.length,
          ),
        );
      }
      return result;
    },

    getStats() {
      const latest = _snapshot?.latest ?? {};
      return {
        count: _snapshot ? Object.keys(_snapshot.series).length : 0,
        gasPadd1b: latest.EMM_EPMR_PTE_R1Y_DPG?.value ?? null,
        dieselPadd1b: latest.EMD_EPD2D_PTE_R1Y_DPG?.value ?? null,
        heatingOilNj: latest.W_EPD2F_PRS_SNJ_DPG?.value ?? null,
        heatingOilState: _snapshot?.heatingOil?.state ?? null,
        latestWeek: _snapshot?.latestWeek ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
