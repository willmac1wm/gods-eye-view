import * as Cesium from 'cesium';
import {
  MARINE_WARNINGS_OVERLAY_SOURCE_ID,
  MARINE_WARNINGS_OVERLAY_COHORT_LIMIT,
  MARINE_WARNINGS_OVERLAY_COLLISION_CAPACITY,
  severityColor,
  createMarineWarningsOverlayEntry,
  selectMarineWarningsOverlayCohort,
  mapAnalystRecord,
} from './model.js';
export * from './model.js';
export { createMarineWarningsSource } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/**
 * Marine Warnings — USCG Broadcast Notices to Mariners (NAVCEN, via the
 * GovDelivery RSS feeds for Sector Delaware Bay + District 5, through the
 * same-origin /api/marine-warnings proxy: GovDelivery sends no CORS
 * headers). Polled every 15 min, only while the layer is enabled.
 *
 * LIST-FIRST (v1): most warnings never get a map pin. ATON notices usually
 * give an aid name + LLNR and no position in the text, so the layer shows
 * every in-force warning in the panel (`count`) and pins only the ones
 * with a parsed position (`pinned`); the rest are `listOnly`. A future
 * LLNR→position join against the USCG Light List would raise the pin
 * rate — see DATA_SOURCES.md. Severity is our heuristic (the source
 * carries no severity field); see records.js.
 *
 * Credit: "U.S. Coast Guard — Sector Delaware Bay / District 5 (NAVCEN)"
 * with a link — see DATA_SOURCES.md.
 */
export function createMarineWarningsLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Marine warnings require a snapshot source');
  if (!overlayHost)
    throw new TypeError('Marine warnings require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _pinnedCount = 0;
  let _cancelledCount = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'marine-warnings',
    name: 'Marine Warnings',
    icon: '⚓',
    source: 'USCG NAVCEN',
    updateInterval: 900000,

    init(viewer) {
      if (_viewer)
        throw new Error('Marine warnings layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('marine-warnings');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _pinnedCount = 0;
      _cancelledCount = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(MARINE_WARNINGS_OVERLAY_SOURCE_ID, false);
      console.log('[Data:MarineWarnings] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(MARINE_WARNINGS_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(MARINE_WARNINGS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(MARINE_WARNINGS_OVERLAY_SOURCE_ID, false);
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
        const nextEntities = [];
        let pinnedCount = 0;
        const overlayEntries = [];

        for (const row of rows) {
          if (!row?.hasPosition) continue; // list-only: panel, no pin
          pinnedCount++;
          const color = severityColor(row.severity);
          const position = Cesium.Cartesian3.fromDegrees(row.lon, row.lat);
          const radius = row.polygon ? 4000 : 1500;
          nextEntities.push(
            new Cesium.Entity({
              id: `marine-warning:${row.stableId}`,
              position,
              ellipse: {
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                stableId: row.stableId,
                originator: row.originator,
                number: row.number,
                criticality: row.criticality,
                area: row.area,
                descriptor: row.descriptor,
                severity: row.severity,
                hasPosition: true,
                polygon: row.polygon,
                llnr: row.llnr,
                pubDateMs: row.pubDateMs,
                cancelAtMs: row.cancelAtMs,
              },
            }),
          );
          overlayEntries.push(
            createMarineWarningsOverlayEntry({
              id: String(row.stableId),
              position,
              row,
            }),
          );
        }

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            MARINE_WARNINGS_OVERLAY_SOURCE_ID,
            selectMarineWarningsOverlayCohort(overlayEntries),
            {
              cohortLimit: MARINE_WARNINGS_OVERLAY_COHORT_LIMIT,
              collisionCapacity: MARINE_WARNINGS_OVERLAY_COLLISION_CAPACITY,
              moving: false,
            },
          );
        }

        _count = rows.length;
        _pinnedCount = pinnedCount;
        _cancelledCount = Number.isFinite(snapshot?.cancelledCount)
          ? snapshot.cancelledCount
          : 0;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:MarineWarnings] Updated: ${_count} warnings (${_pinnedCount} pinned, ${_count - _pinnedCount} list-only)`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:MarineWarnings] Fetch error:', e);
        _lastError = e?.message || msg('Marine warnings source unavailable');
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
      overlayHost.clearSource(MARINE_WARNINGS_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(MARINE_WARNINGS_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _pinnedCount = 0;
      _cancelledCount = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's in-memory positioned warnings as plain JSON-safe
     * objects for the analyst query engine. On-demand only — zero per-frame
     * cost, no listeners, no caching. Returns [] while the layer is
     * disabled or empty. List-only rows have no entity, so they never reach
     * this seam (see model.js mapAnalystRecord).
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
              stableId: p?.stableId?.getValue(now) ?? null,
              originator: p?.originator?.getValue(now) ?? null,
              number: p?.number?.getValue(now) ?? null,
              criticality: p?.criticality?.getValue(now) ?? null,
              area: p?.area?.getValue(now) ?? null,
              descriptor: p?.descriptor?.getValue(now) ?? null,
              severity: p?.severity?.getValue(now) ?? null,
              hasPosition: p?.hasPosition?.getValue(now) ?? null,
              polygon: p?.polygon?.getValue(now) ?? null,
              llnr: p?.llnr?.getValue(now) ?? null,
              pubDateMs: p?.pubDateMs?.getValue(now),
              cancelAtMs: p?.cancelAtMs?.getValue(now),
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
        pinned: _pinnedCount,
        listOnly: _count - _pinnedCount,
        cancelledCount: _cancelledCount,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
