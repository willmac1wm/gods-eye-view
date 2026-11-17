import * as Cesium from 'cesium';
import {
  OUTAGES_OVERLAY_SOURCE_ID,
  OUTAGES_OVERLAY_COHORT_LIMIT,
  severityColor,
  createOutagesOverlayEntry,
  createOutagesCountyOverlayEntry,
  mapAnalystRecord,
} from './model.js';
import { severityForPct } from './records.js';
export * from './model.js';
export { createMassOutageSource } from './source.js';

// A portable package (no i18n): the error stays English data and the layer
// panel shows it translated.
const msg = (text) => text;

/** Own one county-outage display and its refresh lifecycle. */
export function createOutagesLayer({ source, overlayHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Outages require a snapshot source');
  if (!overlayHost) throw new TypeError('Outages require an overlay host');
  let _viewer = null;
  let _request = null;
  let _dataSource = null;
  let _count = 0;
  let _customersOut = null;
  let _majorEvent = false;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'outages',
    name: 'Power Outages',
    icon: '💡',
    source: 'MassOutage',
    updateInterval: 300000,

    init(viewer) {
      if (_viewer) throw new Error('Outages layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('outages');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _customersOut = null;
      _majorEvent = false;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(OUTAGES_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Outages] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(OUTAGES_OVERLAY_SOURCE_ID, true);
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(OUTAGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OUTAGES_OVERLAY_SOURCE_ID, false);
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

        for (const area of snapshot.areas) {
          count++;
          const severity = severityForPct(area.pctOut);
          const color = severityColor(severity);
          nextEntities.push(
            new Cesium.Entity({
              id: `outage:${area.name}`,
              rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(
                  area.bbox.west,
                  area.bbox.south,
                  area.bbox.east,
                  area.bbox.north,
                ),
                material: new Cesium.ColorMaterialProperty(
                  color.withAlpha(0.35),
                ),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                name: area.name,
                customersOut: area.customersOut,
                customersServed: area.customersServed,
                pctOut: area.pctOut,
                severity,
                etr: area.etr,
                asOf: area.asOf,
                lat: area.lat,
                lon: area.lon,
              },
            }),
          );
          overlayEntries.push(
            createOutagesOverlayEntry({
              id: area.name,
              area,
              severity,
            }),
          );
        }
        // The county summary label always renders — a quiet county ("no
        // outages reported") is information, not an empty state.
        overlayEntries.unshift(
          createOutagesCountyOverlayEntry({
            county: snapshot.county,
            majorEvent: snapshot.majorEvent,
          }),
        );

        _dataSource.entities.removeAll();
        for (const entity of nextEntities) _dataSource.entities.add(entity);
        if (_enabled) {
          overlayHost.setEntries(
            OUTAGES_OVERLAY_SOURCE_ID,
            overlayEntries.slice(0, OUTAGES_OVERLAY_COHORT_LIMIT + 1),
            {
              cohortLimit: OUTAGES_OVERLAY_COHORT_LIMIT + 1,
              moving: false,
            },
          );
        }

        _count = count;
        _customersOut = snapshot.county.customersOut;
        _majorEvent = snapshot.majorEvent;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(
          `[Data:Outages] Updated: ${_count} areas, ${_customersOut} customers out`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:Outages] Fetch error:', e);
        _lastError = e?.message || msg('Outages source unavailable');
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
      overlayHost.clearSource(OUTAGES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(OUTAGES_OVERLAY_SOURCE_ID, false);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _customersOut = null;
      _majorEvent = false;
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's in-memory outage records as plain JSON-safe
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
              name: p?.name?.getValue(now) ?? null,
              customersOut: p?.customersOut?.getValue(now),
              customersServed: p?.customersServed?.getValue(now),
              pctOut: p?.pctOut?.getValue(now),
              severity: p?.severity?.getValue(now) ?? null,
              etr: p?.etr?.getValue(now) ?? null,
              asOf: p?.asOf?.getValue(now) ?? null,
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
        customersOut: _customersOut,
        majorEvent: _majorEvent,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
