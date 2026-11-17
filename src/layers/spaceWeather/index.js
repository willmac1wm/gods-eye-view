import * as Cesium from 'cesium';
import {
  SPACE_WEATHER_OVERLAY_SOURCE_ID,
  SPACE_WEATHER_OVERLAY_COHORT_LIMIT,
  createSpaceWeatherOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { LAYER_ID, SPACE_WEATHER_REFRESH_MS } from './policy.js';
export * from './model.js';
export { createSpaceWeatherSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one space-weather display and its refresh lifecycle. The card
 * polls every 5 minutes for current Kp (the value changes minute to
 * minute but the card does not need sub-5-min freshness); the provider
 * caches the slow products (Kp forecast, 3-day text) for 6 hours.
 */
export function createSpaceWeatherLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Space weather requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('Space weather requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'Space weather',
    icon: '☀️',
    source: 'NOAA SWPC',
    updateInterval: SPACE_WEATHER_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Space weather layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('space-weather');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SPACE_WEATHER_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SpaceWeather] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SPACE_WEATHER_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SPACE_WEATHER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SPACE_WEATHER_OVERLAY_SOURCE_ID, false);
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
            SPACE_WEATHER_OVERLAY_SOURCE_ID,
            [createSpaceWeatherOverlayEntry({ snapshot })].slice(
              0,
              SPACE_WEATHER_OVERLAY_COHORT_LIMIT,
            ),
            {
              cohortLimit: SPACE_WEATHER_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:SpaceWeather] Updated: Kp ${snapshot.kp.kp} (${snapshot.kp.activity})`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SpaceWeather] Fetch error:', e);
        _lastError = e?.message || msg('Space weather source unavailable');
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
      overlayHost.clearSource(SPACE_WEATHER_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SPACE_WEATHER_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's current Kp reading as a plain JSON-safe
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
      return [
        mapAnalystRecord(
          {
            id: 'space-weather-current',
            kp: _snapshot.kp.kp,
            gScale: _snapshot.kp.gScale,
            activity: _snapshot.kp.activity,
            forecastMaxKp: _snapshot.forecast?.maxKp ?? null,
            solarWindSpeed: _snapshot.solarWind?.speed ?? null,
            bzGsm: _snapshot.mag?.bzGsm ?? null,
            timeTag: _snapshot.kp.timeTag,
          },
          0,
        ),
      ];
    },

    getStats() {
      return {
        count: _snapshot ? 1 : 0,
        kp: _snapshot?.kp?.kp ?? null,
        gScale: _snapshot?.kp?.gScale ?? null,
        activity: _snapshot?.kp?.activity ?? null,
        forecastMaxKp: _snapshot?.forecast?.maxKp ?? null,
        solarWindSpeed: _snapshot?.solarWind?.speed ?? null,
        bzGsm: _snapshot?.mag?.bzGsm ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
