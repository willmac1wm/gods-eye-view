import * as Cesium from 'cesium';
import {
  TIDES_OVERLAY_SOURCE_ID,
  TIDES_OVERLAY_COHORT_LIMIT,
  stageColor,
  createTidesOverlayEntry,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createCoopsTidesSource } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/** Own one tide-gauge display and its refresh lifecycle. */
export function createTidesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Tides require a snapshot source');
  if (!overlayHost) throw new TypeError('Tides require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'tides',
    name: 'Tides & Water Levels',
    icon: '🌊',
    source: 'NOAA CO-OPS',
    updateInterval: 360000,

    init(viewer) {
      if (_viewer) throw new Error('Tides layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('tides');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(TIDES_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Tides] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(TIDES_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(TIDES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TIDES_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const nextEntities = [];
        let count = 0;
        const overlayEntries = [];

        for (const row of rows) {
          count++;
          const color = stageColor(row.floodStage);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `tide:${row.stationId}`,
              position,
              ellipse: {
                semiMajorAxis: 1500,
                semiMinorAxis: 1500,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stationId: row.stationId,
                name: row.name,
                observedFtMllw: row.observedFtMllw,
                predictedFtMllw: row.predictedFtMllw,
                residualFt: row.residualFt,
                floodStage: row.floodStage,
                trend: row.trend,
                observedTime: row.observedTime,
              },
            }),
          );
          overlayEntries.push(
            createTidesOverlayEntry({
              id: String(row.stationId),
              position,
              row,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            TIDES_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, TIDES_OVERLAY_COHORT_LIMIT),
            {
              cohortLimit: TIDES_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Tides] Updated: ${_count} gauges`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Tides] Fetch error:', e);
        _lastError = e?.message || msg('Tides source unavailable');
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
      overlayHost.clearSource(TIDES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TIDES_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's in-memory gauge records as plain JSON-safe
     * objects for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while the layer is
     * disabled or empty.
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const now = Cesium.JulianDate.now();
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const cartesian = entity.position
          ? entity.position.getValue(now)
          : null;
        const carto = cartesian
          ? Cesium.Cartographic.fromCartesian(cartesian)
          : null;
        const p = entity.properties;
        result.push(
          mapAnalystRecord(
            {
              stationId: p?.stationId?.getValue(now) ?? null,
              name: p?.name?.getValue(now) ?? null,
              observedFtMllw: p?.observedFtMllw?.getValue(now),
              predictedFtMllw: p?.predictedFtMllw?.getValue(now),
              residualFt: p?.residualFt?.getValue(now),
              floodStage: p?.floodStage?.getValue(now) ?? null,
              trend: p?.trend?.getValue(now) ?? null,
              observedTime: p?.observedTime?.getValue(now) ?? null,
              lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
              lon: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
            },
            result.length,
          ),
        );
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
