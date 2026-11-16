import * as Cesium from 'cesium';
import {
  SURVEILLANCE_OVERLAY_SOURCE_ID,
  SURVEILLANCE_OVERLAY_COHORT_LIMIT,
  surveillanceStateColor,
  createSurveillanceOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { LAYER_ID, MAX_VIEWPORT_DEGREES, QUERY_REUSE_MS } from './policy.js';
export * from './model.js';
export { createSurveillanceSource } from './source.js';
export * from './records.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Current camera view box in degrees, or null when the camera looks at the
 * sky/horizon (no ground rectangle). Pure over a Cesium.Rectangle so the
 * conversion is pinnable without a viewer.
 * @param {object} rect - Cesium.Rectangle in radians
 * @returns {{south:number, west:number, north:number, east:number}|null}
 */
export function viewBoxFromRectangle(rect) {
  if (!rect) return null;
  const south = Cesium.Math.toDegrees(rect.south);
  const west = Cesium.Math.toDegrees(rect.west);
  const north = Cesium.Math.toDegrees(rect.north);
  const east = Cesium.Math.toDegrees(rect.east);
  if (
    ![south, west, north, east].every(Number.isFinite) ||
    north <= south ||
    east <= west
  )
    return null;
  return { south, west, north, east };
}

/** Whether `inner` lies entirely within `outer` (no dateline handling). */
export function boxContains(outer, inner) {
  if (!outer || !inner) return false;
  return (
    inner.south >= outer.south &&
    inner.north <= outer.north &&
    inner.west >= outer.west &&
    inner.east <= outer.east
  );
}

/** Own one surveillance-camera display and its refresh lifecycle. */
export function createSurveillanceLayer({ source, overlayHost } = {}) {
  if (typeof source?.fetch !== 'function')
    throw new TypeError('Surveillance cameras require a camera source');
  if (!overlayHost)
    throw new TypeError('Surveillance cameras require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _lastFetchedAt = 0;
  let _lastCoverage = null;
  let _zoomIn = false;
  let _enabled = false;
  let _moveEndRemover = null;

  const layer = {
    id: LAYER_ID,
    name: 'Surveillance cameras',
    icon: '📹',
    source: 'OpenStreetMap',
    updateInterval: 0,
    // Hourly lifecycle tick is a backstop only: the layer refetches at most
    // once per QUERY_REUSE_MS per viewport (24 h), and only when the view
    // moved outside the last coverage or the last fetch failed. There is no
    // polling loop — this data barely changes.
    refreshInterval: 3600000,

    init(viewer) {
      if (_viewer)
        throw new Error('Surveillance cameras layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('surveillance-cameras');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _lastFetchedAt = 0;
      _lastCoverage = null;
      _zoomIn = false;
      _enabled = false;
      overlayHost.setVisible(SURVEILLANCE_OVERLAY_SOURCE_ID, false);
      // Viewport-driven refresh: refetch when the camera settles somewhere
      // new, never per frame. Guarded so a viewer without a camera event
      // bus (tests, headless hosts) still constructs.
      try {
        const add = viewer?.camera?.moveEnd?.addEventListener;
        if (typeof add === 'function') {
          _moveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
            if (!_enabled) return;
            void layer.update(_viewer);
          });
        }
      } catch {
        _moveEndRemover = null;
      }
      console.log('[Data:Surveillance] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SURVEILLANCE_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SURVEILLANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SURVEILLANCE_OVERLAY_SOURCE_ID, false);
    },

    async update(viewer, { signal } = {}) {
      if (!_enabled || !_dataSource) return false;
      const activeViewer = viewer || _viewer;
      let box = null;
      try {
        const rect = activeViewer?.camera?.computeViewRectangle?.(
          activeViewer?.scene?.globe?.ellipsoid,
        );
        box = viewBoxFromRectangle(rect);
      } catch {
        box = null;
      }
      // Sky/horizon: keep the current pins, no fetch, no failure.
      if (!box) return true;
      if (
        box.north - box.south > MAX_VIEWPORT_DEGREES ||
        box.east - box.west > MAX_VIEWPORT_DEGREES
      ) {
        // Too wide to query honestly: keep the current pins and say so.
        // This is guidance, not an error — it must not flag a refresh failure.
        _zoomIn = true;
        return true;
      }
      _zoomIn = false;
      // Reuse: same coverage and fresh data — no Overpass call. A failed
      // last fetch never reuses: the next tick retries instead of waiting
      // out the 24-hour window with an error on screen.
      if (
        !_lastError &&
        _lastCoverage &&
        boxContains(_lastCoverage, box) &&
        Date.now() - _lastFetchedAt < QUERY_REUSE_MS
      )
        return true;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      if (signal) {
        signal.addEventListener('abort', () => request.abort(signal.reason), {
          once: true,
        });
      }
      try {
        const snapshot = await source.fetch(box, { signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;

        const nextEntities = [];
        let count = 0;
        const overlayEntries = [];

        for (const camera of snapshot.records) {
          count++;
          const color = surveillanceStateColor(snapshot.stale);
          const position = Cesium.Cartesian3.fromDegrees(
            camera.longitude,
            camera.latitude,
          );
          nextEntities.push(
            new Cesium.Entity({
              id: `surveillance:${camera.id}`,
              position,
              ellipse: {
                semiMajorAxis: 500,
                semiMinorAxis: 500,
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
                osmId: camera.osmId,
                operator: camera.operator ?? null,
                manufacturer: camera.manufacturer ?? null,
                cameraType: camera.cameraType ?? null,
                zone: camera.zone ?? null,
                directionDeg: camera.directionDeg ?? null,
                stale: snapshot.stale,
                lat: camera.latitude,
                lon: camera.longitude,
              },
            }),
          );
          overlayEntries.push(
            createSurveillanceOverlayEntry({
              id: camera.id,
              camera: { ...camera, stale: snapshot.stale },
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            SURVEILLANCE_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, SURVEILLANCE_OVERLAY_COHORT_LIMIT),
            {
              cohortLimit: SURVEILLANCE_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _count = count;
        _lastUpdate = Date.now();
        _lastFetchedAt = Date.now();
        _lastCoverage = snapshot.coverage ?? { ...box };
        _lastError = null;
        console.log(`[Data:Surveillance] Updated: ${_count} cameras`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Surveillance] Fetch error:', e);
        _lastError =
          e?.message || msg('Surveillance cameras source unavailable');
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
      if (_moveEndRemover) {
        _moveEndRemover();
        _moveEndRemover = null;
      }
      overlayHost.clearSource(SURVEILLANCE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SURVEILLANCE_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _lastFetchedAt = 0;
      _lastCoverage = null;
      _zoomIn = false;
    },

    /**
     * Snapshot the layer's in-memory camera records as plain JSON-safe
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
              id: p?.cameraId?.getValue(now) ?? null,
              operator: p?.operator?.getValue(now),
              manufacturer: p?.manufacturer?.getValue(now),
              cameraType: p?.cameraType?.getValue(now),
              zone: p?.zone?.getValue(now),
              directionDeg: p?.directionDeg?.getValue(now),
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
        lastUpdate: _lastUpdate,
        error: _lastError,
        zoomIn: _zoomIn,
      };
    },
  };
  return layer;
}
