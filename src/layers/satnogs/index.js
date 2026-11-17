import * as Cesium from 'cesium';
import {
  SATNOGS_OVERLAY_SOURCE_ID,
  SATNOGS_OVERLAY_COHORT_LIMIT,
  SATNOGS_OVERLAY_COLLISION_CAPACITY,
  satnogsStationColor,
  createSatnogsOverlayEntry,
  selectSatnogsOverlayCohort,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createSatnogsSource } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * SatNOGS — satellite observations heard by the nearest ground stations.
 *
 * "What the county's nearest SatNOGS ears heard": recent + scheduled
 * observations from the four Online SatNOGS ground stations within
 * 200 km of Cape May County (see stations.js), through the same-origin
 * /api/satnogs proxy — neither SatNOGS API sends CORS headers
 * (verified 2026-11-16). Polled every 20 min, only while the layer is
 * enabled. Trailing 7 days completed (`status=good`) + next 48 h
 * scheduled (`status=future`); each completed observation links its
 * waterfall PNG and audio OGG.
 *
 * STATION-FIRST (v1): markers sit on the ground stations, not on the
 * satellites — observations carry station lat/lng and no satellite
 * position, and one station hears dozens of passes a week. The panel
 * lists every observation under its station; the analyst seam sees one
 * record per observation, positioned at its station.
 *
 * This layer ingests NO TLEs and predicts NO passes — the TLE-based
 * satellites layer (CelesTrak + SGP4) already does that. SatNOGS DB is
 * used for satellite identity (names) only.
 *
 * Credit: "Satellite observations: SatNOGS" (CC BY-SA 4.0) with a link —
 * see DATA_SOURCES.md.
 */
export function createSatnogsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('SatNOGS requires a snapshot source');
  if (!overlayHost) throw new TypeError('SatNOGS requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _completedCount = 0;
  let _scheduledCount = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'satnogs',
    name: 'SatNOGS Observations',
    icon: '🛰️',
    source: 'SatNOGS',
    updateInterval: 1200000,

    init(viewer) {
      if (_viewer) throw new Error('SatNOGS layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('satnogs');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _completedCount = 0;
      _scheduledCount = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(SATNOGS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:SatNOGS] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(SATNOGS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(SATNOGS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SATNOGS_OVERLAY_SOURCE_ID, false);
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

        const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
        const stations = Array.isArray(snapshot?.stations)
          ? snapshot.stations
          : [];
        const nextEntities = [];
        const overlayEntries = [];

        for (const station of stations) {
          if (!Number.isFinite(station?.lat) || !Number.isFinite(station?.lon))
            continue;
          const color = satnogsStationColor(station);
          const position = Cesium.Cartesian3.fromDegrees(
            station.lon,
            station.lat,
          );
          const stationRows = rows.filter(
            (row) => row?.stationId === station.id,
          );
          nextEntities.push(
            new Cesium.Entity({
              id: `satnogs-station:${station.id}`,
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
                stationId: station.id,
                stationName: station.name,
                distanceKm: station.distanceKm,
                observations: station.observations,
                successRate: station.successRate,
                completedCount: station.completedCount,
                scheduledCount: station.scheduledCount,
                latestStartMs: station.latestStartMs,
                // The station's observations ride on the entity so the
                // analyst seam can read them back without a second store.
                observationsJson: stationRows,
              },
            }),
          );
          overlayEntries.push(
            createSatnogsOverlayEntry({
              id: String(station.id),
              position,
              station,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            SATNOGS_OVERLAY_SOURCE_ID,
            selectSatnogsOverlayCohort(overlayEntries),
            {
              cohortLimit: SATNOGS_OVERLAY_COHORT_LIMIT,
              collisionCapacity: SATNOGS_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _count = rows.length;
        _completedCount = Number.isFinite(snapshot?.completedCount)
          ? snapshot.completedCount
          : rows.filter((row) => row?.status === 'good').length;
        _scheduledCount = Number.isFinite(snapshot?.scheduledCount)
          ? snapshot.scheduledCount
          : rows.filter((row) => row?.status === 'future').length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:SatNOGS] Updated: ${_count} observations (${_completedCount} heard, ${_scheduledCount} scheduled) at ${stations.length} stations`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:SatNOGS] Fetch error:', e);
        _lastError = e?.message || msg('SatNOGS source unavailable');
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
      overlayHost.clearSource(SATNOGS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(SATNOGS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _completedCount = 0;
      _scheduledCount = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's observations as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while the layer is disabled or
     * empty. One record per observation, positioned at its ground
     * station (see model.js mapAnalystRecord).
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
        const stationRows = p?.observationsJson?.getValue(now) ?? [];
        for (const row of stationRows) {
          if (result.length >= limit) break;
          result.push(
            mapAnalystRecord(
              {
                ...row,
                hasPosition: true,
              },
              result.length,
            ),
          );
        }
      }
      return result;
    },

    getStats() {
      return {
        count: _count,
        completed: _completedCount,
        scheduled: _scheduledCount,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
