import * as Cesium from 'cesium';
import {
  TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID,
  TRAFFIC_CAMERAS_OVERLAY_COHORT_LIMIT,
  createTrafficCameraOverlayEntry,
  trafficCameraStateColor,
  mapAnalystRecord,
} from './model.js';
import {
  LAYER_ID,
  TRAFFIC_CAMERAS_REFRESH_MS,
  TRAFFIC_CAMERAS_PIN_RADIUS_M,
} from './policy.js';
export * from './model.js';
export { createTrafficCamerasSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Own one traffic-camera display and its refresh lifecycle. The two
 * providers return the whole county camera set at once (no viewport
 * query): NJ511 cameras appear the moment NJ511_API_KEY is configured;
 * until then the layer is DelDOT + DRBA ferry cameras with a plain note.
 * Pins are 500 m ellipses like the surveillance layer; stills refresh on
 * card open, never on a timer.
 */
export function createTrafficCamerasLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Traffic cameras require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Traffic cameras require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _snapshot = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: LAYER_ID,
    name: 'Traffic cameras',
    icon: '🎥',
    source: 'NJDOT 511NJ · DelDOT',
    updateInterval: TRAFFIC_CAMERAS_REFRESH_MS,

    init(viewer) {
      if (_viewer)
        throw new Error('Traffic cameras layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('traffic-cameras');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:TrafficCameras] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer, { signal } = {}) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      if (signal) {
        signal.addEventListener('abort', () => request.abort(signal.reason), {
          once: true,
        });
      }
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const nextEntities = [];
        let count = 0;
        const overlayEntries = [];

        for (const camera of snapshot.records) {
          count++;
          const color = trafficCameraStateColor(camera, snapshot.stale);
          const position = Cesium.Cartesian3.fromDegrees(
            camera.lng,
            camera.lat,
          );
          nextEntities.push(
            new Cesium.Entity({
              id: `traffic-camera:${camera.id}`,
              position,
              ellipse: {
                semiMajorAxis: TRAFFIC_CAMERAS_PIN_RADIUS_M,
                semiMinorAxis: TRAFFIC_CAMERAS_PIN_RADIUS_M,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                cameraId: camera.id,
                name: camera.name ?? null,
                road: camera.road ?? null,
                source: camera.source ?? null,
                imageUrl: camera.imageUrl ?? null,
                heading: camera.heading ?? null,
                stale: snapshot.stale,
                lat: camera.lat,
                lon: camera.lng,
              },
            }),
          );
          overlayEntries.push(
            createTrafficCameraOverlayEntry({
              id: camera.id,
              camera: { ...camera, stale: snapshot.stale },
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, TRAFFIC_CAMERAS_OVERLAY_COHORT_LIMIT),
            {
              cohortLimit: TRAFFIC_CAMERAS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _snapshot = snapshot;
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:TrafficCameras] Updated: ${_count} cameras ` +
            `(NJ511 ${snapshot.nj511Count}, DelDOT ${snapshot.deldotCount})`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:TrafficCameras] Fetch error:', e);
        _lastError = e?.message || msg('Traffic cameras source unavailable');
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
      overlayHost.clearSource(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(TRAFFIC_CAMERAS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _snapshot = null;
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's camera records as plain JSON-safe objects for
     * the analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while the layer is disabled or
     * empty.
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
              id: p?.cameraId?.getValue(now) ?? null,
              name: p?.name?.getValue(now),
              road: p?.road?.getValue(now),
              source: p?.source?.getValue(now),
              heading: p?.heading?.getValue(now),
              imageUrl: p?.imageUrl?.getValue(now),
              stale: p?.stale?.getValue(now) ?? null,
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
        nj511Count: _snapshot?.nj511Count ?? null,
        deldotCount: _snapshot?.deldotCount ?? null,
        nj511Configured: _snapshot?.nj511Configured ?? null,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
