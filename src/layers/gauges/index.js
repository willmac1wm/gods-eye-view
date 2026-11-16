import * as Cesium from 'cesium';
import {
  GAUGES_OVERLAY_SOURCE_ID,
  GAUGES_OVERLAY_COHORT_LIMIT,
  gaugeStateColor,
  createGaugesOverlayEntry,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createUsgsGaugesSource } from './source.js';
export * from './sites.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/** Own one water-gauge display and its refresh lifecycle. */
export function createGaugesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Water gauges require a snapshot source');
  if (!overlayHost) throw new TypeError('Water gauges require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'water-gauges',
    name: 'Water Gauges',
    icon: '💧',
    source: 'USGS',
    updateInterval: 900000,

    init(viewer) {
      if (_viewer) throw new Error('Water gauges layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('water-gauges');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(GAUGES_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Gauges] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(GAUGES_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(GAUGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GAUGES_OVERLAY_SOURCE_ID, false);
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

        const nextEntities = [];
        let count = 0;
        const overlayEntries = [];

        for (const gauge of snapshot.gauges) {
          count++;
          const color = gaugeStateColor(gauge.stale);
          const position = Cesium.Cartesian3.fromDegrees(gauge.lon, gauge.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `gauge:${gauge.siteId}`,
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
                siteId: gauge.siteId,
                name: gauge.name,
                dischargeCfs: gauge.discharge?.value ?? null,
                gageHeightFt: gauge.gageHeight?.value ?? null,
                provisional:
                  gauge.gageHeight?.approvalStatus === 'Provisional' ||
                  gauge.discharge?.approvalStatus === 'Provisional',
                stale: gauge.stale,
                time: gauge.gageHeight?.time ?? gauge.discharge?.time ?? null,
                lat: gauge.lat,
                lon: gauge.lon,
              },
            }),
          );
          overlayEntries.push(
            createGaugesOverlayEntry({
              id: gauge.siteId,
              gauge,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            GAUGES_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, GAUGES_OVERLAY_COHORT_LIMIT),
            {
              cohortLimit: GAUGES_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:Gauges] Updated: ${_count} gauges`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Gauges] Fetch error:', e);
        _lastError = e?.message || msg('Water gauges source unavailable');
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
      overlayHost.clearSource(GAUGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GAUGES_OVERLAY_SOURCE_ID, false);
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
        const p = entity.properties;
        result.push(
          mapAnalystRecord(
            {
              siteId: p?.siteId?.getValue(now) ?? null,
              name: p?.name?.getValue(now) ?? null,
              dischargeCfs: p?.dischargeCfs?.getValue(now),
              gageHeightFt: p?.gageHeightFt?.getValue(now),
              provisional: p?.provisional?.getValue(now) ?? null,
              stale: p?.stale?.getValue(now) ?? null,
              time: p?.time?.getValue(now) ?? null,
              lat: p?.lat?.getValue(now),
              lon: p?.lon?.getValue(now),
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
