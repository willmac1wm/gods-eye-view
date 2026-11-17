import * as Cesium from 'cesium';
import {
  FAA_STATUS_OVERLAY_SOURCE_ID,
  FAA_STATUS_OVERLAY_COHORT_LIMIT,
  severityColor,
  createFaaStatusOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { FAA_STATUS_LOCAL_AIRPORTS } from './records.js';
export * from './model.js';
export * from './records.js';
export { createFaaNasSource } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/** Own one FAA airport-status display and its refresh lifecycle. */
export function createFaaStatusLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('FAA airport status requires a snapshot source');
  if (!overlayHost)
    throw new TypeError('FAA airport status requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _nationwideGroundStops = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'faa-status',
    name: 'FAA Airport Status',
    icon: '✈️',
    source: 'FAA NAS Status',
    updateInterval: 180000,

    init(viewer) {
      if (_viewer)
        throw new Error('FAA airport status layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('faa-status');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _nationwideGroundStops = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(FAA_STATUS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:FaaStatus] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(FAA_STATUS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(FAA_STATUS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FAA_STATUS_OVERLAY_SOURCE_ID, false);
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

        for (const event of snapshot.local) {
          const airport = FAA_STATUS_LOCAL_AIRPORTS[event.airport];
          if (!airport) continue;
          count++;
          const color = severityColor(event.category);
          const position = Cesium.Cartesian3.fromDegrees(
            airport.lon,
            airport.lat,
          );
          nextEntities.push(
            new Cesium.Entity({
              id: `${event.airport}:${event.category}`,
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
                airport: event.airport,
                category: event.category,
                reason: event.reason ?? null,
                start: event.start ?? null,
                reopen: event.reopen ?? null,
                endTime: event.endTime ?? null,
                avg: event.avg ?? null,
                max: event.max ?? null,
                trend: event.trend ?? null,
                delayType: event.delayType ?? null,
                lat: airport.lat,
                lon: airport.lon,
              },
            }),
          );
          overlayEntries.push(createFaaStatusOverlayEntry({ event }));
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            FAA_STATUS_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, FAA_STATUS_OVERLAY_COHORT_LIMIT),
            {
              cohortLimit: FAA_STATUS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _count = count;
        _nationwideGroundStops = snapshot.nationwide?.groundStop ?? 0;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:FaaStatus] Updated: ${_count} local events`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:FaaStatus] Fetch error:', e);
        _lastError = e?.message || msg('FAA status source unavailable');
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
      overlayHost.clearSource(FAA_STATUS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(FAA_STATUS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _nationwideGroundStops = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's in-memory local events as plain JSON-safe
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
              airport: p?.airport?.getValue(now) ?? null,
              category: p?.category?.getValue(now) ?? null,
              reason: p?.reason?.getValue(now) ?? null,
              start: p?.start?.getValue(now) ?? null,
              reopen: p?.reopen?.getValue(now) ?? null,
              endTime: p?.endTime?.getValue(now) ?? null,
              avg: p?.avg?.getValue(now) ?? null,
              max: p?.max?.getValue(now) ?? null,
              trend: p?.trend?.getValue(now) ?? null,
              delayType: p?.delayType?.getValue(now) ?? null,
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
        nationwideGroundStops: _nationwideGroundStops,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
