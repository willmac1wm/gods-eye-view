import * as Cesium from 'cesium';
import {
  APRS_OVERLAY_SOURCE_ID,
  APRS_OVERLAY_COHORT_LIMIT,
  aprsMarkerColor,
  createAprsOverlayEntry,
  selectAprsOverlayCohort,
  mapAnalystRecord,
} from './model.js';
import { AprsKeyMissingError } from './source.js';
export * from './model.js';
export { createAprsWeatherSource, AprsKeyMissingError } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * APRS / CWOP weather stations (aprs.fi, via the same-origin /api/aprs
 * proxy — the key lives in server env only, and aprs.fi sends no CORS
 * headers). Fetched only while the layer is enabled: the aprs.fi terms
 * allow requests only when actively needed by the end-user, with no
 * preloading, pre-caching, or archival collection.
 *
 * Credit (aprs.fi terms): the layer panel carries "Weather: aprs.fi"
 * with a link back to https://aprs.fi — see DATA_SOURCES.md.
 */
export function createAprsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('APRS weather requires a snapshot source');
  if (!overlayHost) throw new TypeError('APRS weather requires an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _freshCount = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'aprs-weather',
    name: 'APRS / CWOP Weather',
    icon: '🌡️',
    source: 'aprs.fi',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer) throw new Error('APRS weather layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('aprs-weather');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _freshCount = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(APRS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:APRS] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(APRS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(APRS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(APRS_OVERLAY_SOURCE_ID, false);
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
        let freshCount = 0;
        const overlayEntries = [];

        for (const row of rows) {
          count++;
          if (!row.stale && !row.missing) freshCount++;
          const color = aprsMarkerColor(row);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          nextEntities.push(
            new Cesium.Entity({
              id: `aprs:${row.callsign}`,
              position,
              ellipse: {
                semiMajorAxis: 800,
                semiMinorAxis: 800,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(row.stale || row.missing ? 0.2 : 0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                callsign: row.callsign,
                place: row.place,
                tempF: row.tempF,
                humidity: row.humidity,
                pressureInHg: row.pressureInHg,
                windDirDeg: row.windDirDeg,
                windSpeedMph: row.windSpeedMph,
                windGustMph: row.windGustMph,
                rain24hMm: row.rain24hMm,
                timeMs: row.timeMs,
                ageMin: row.ageMin,
                stale: row.stale,
                missing: row.missing,
              },
            }),
          );
          overlayEntries.push(
            createAprsOverlayEntry({
              id: String(row.callsign),
              position,
              row,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            APRS_OVERLAY_SOURCE_ID,
            selectAprsOverlayCohort(overlayEntries),
            {
              cohortLimit: APRS_OVERLAY_COHORT_LIMIT,
              moving: false,
            },
          );
        }

        _count = count;
        _freshCount = freshCount;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:APRS] Updated: ${_count} stations (${_freshCount} fresh)`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:APRS] Fetch error:', e);
        // The key-missing state is its own message, not a generic failure:
        // the layer renders empty until APRSFI_API_KEY is configured.
        _lastError =
          e instanceof AprsKeyMissingError
            ? msg('APRS key not configured')
            : e?.message || msg('APRS source unavailable');
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
      overlayHost.clearSource(APRS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(APRS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _freshCount = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's in-memory station records as plain JSON-safe
     * objects for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while the layer is
     * disabled or empty. Stale rows are included with `stale: true` so
     * queries can exclude them from "current conditions" counts.
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
              callsign: p?.callsign?.getValue(now) ?? null,
              place: p?.place?.getValue(now) ?? null,
              tempF: p?.tempF?.getValue(now),
              humidity: p?.humidity?.getValue(now),
              pressureInHg: p?.pressureInHg?.getValue(now),
              windDirDeg: p?.windDirDeg?.getValue(now),
              windSpeedMph: p?.windSpeedMph?.getValue(now),
              windGustMph: p?.windGustMph?.getValue(now),
              rain24hMm: p?.rain24hMm?.getValue(now),
              timeMs: p?.timeMs?.getValue(now),
              stale: p?.stale?.getValue(now) ?? null,
              missing: p?.missing?.getValue(now) ?? null,
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
        freshCount: _freshCount,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
