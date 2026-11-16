import * as Cesium from 'cesium';
import { formatNumber, msg, t } from '../../i18n/index.js';
import { translateFeedError } from '../../ui/statusText.js';
import { GPSJAM_LEVEL_COLORS, GPSJAM_MIN_AIRCRAFT } from './records.js';
import { mapAnalystRecord } from './model.js';
export * from './records.js';
export * from './model.js';
export { createGpsjamSource } from './source.js';

/**
 * GroundPrimitive allowPicking:false suppresses ids but still submits stencil
 * commands in Cesium's pick pass, erasing picks of overlapping ground geometry.
 * This fill participates only in rendering, so sibling polygons remain pickable.
 */
class GpsjamGroundFill extends Cesium.GroundPrimitive {
  update(frameState) {
    if (!frameState.passes.pick) super.update(frameState);
  }
}

/** Low stays visible over land so coverage reads apart from no data. */
const FILL_ALPHA = Object.freeze({ low: 0.3, medium: 0.42, high: 0.55 });
const LEVEL_LABELS = Object.freeze({
  low: msg('Low-accuracy score < 2%'),
  medium: msg('Low-accuracy score 2–10%'),
  high: msg('Low-accuracy score > 10%'),
});

/**
 * GPSJam daily GNSS interference — the published 24-hour aggregate from
 * gpsjam.org, through the same-origin /api/gpsjam proxy (gpsjam.org
 * sends no CORS headers, verified 2026-11-16). Polled every hour, only
 * while the layer is enabled. One H3 resolution-4 hexagon per cell over
 * the county box + 0.5° margin (~13 cells), coloured by gpsjam.org's
 * low-accuracy score. Green cells are drawn too: with 13 cells there
 * is no clutter, and hiding them would confuse "all clear" with "no
 * data".
 *
 * This is the daily published aggregate, not live data — the live
 * rolling-30-minute snapshot from adsb.lol is the separate GNSS
 * Integrity layer, which borrows the same formula and bands but fetches
 * no gpsjam.org data. The two layers are complementary: daily
 * hexagons here, live rectangles there.
 *
 * A medium/high cell is a navigation-integrity anomaly, not a
 * detection of jamming or spoofing: red and yellow hexes show where
 * aircraft reported low navigation accuracy, and avionics faults and
 * military trainers also report low values.
 *
 * Credit: "Data: gpsjam.org (John Wiseman / ADS-B Exchange)" — no
 * licence label: gpsjam.org's own pages state no licence (checked
 * live 2026-11-16), so no CC-BY claim is made. See DATA_SOURCES.md.
 */
export function createGpsjamLayer({ source, now = () => Date.now() } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('GPSJam layer requires a snapshot source');
  let _viewer = null;
  let _primitives = null;
  let _request = null;
  let _enabled = false;
  let _cells = [];
  let _date = null;
  let _sourceName = null;
  let _suspect = false;
  let _stale = false;
  let _signature = null;
  let _lastUpdate = null;
  let _lastError = null;

  function render() {
    // Only the hex and band change what is drawn; counts alone do not.
    const signature = JSON.stringify(
      _cells.map(({ hex, level }) => [hex, level]),
    );
    if (signature === _signature) return;
    _signature = signature;
    _primitives.removeAll();
    if (_cells.length) {
      _primitives.add(
        new GpsjamGroundFill({
          geometryInstances: _cells.map(
            (cell) =>
              new Cesium.GeometryInstance({
                id: `${layer.id}:${cell.hex}`,
                geometry: new Cesium.PolygonGeometry({
                  polygonHierarchy: new Cesium.PolygonHierarchy(
                    Cesium.Cartesian3.fromDegreesArray(cell.boundary.flat()),
                  ),
                  vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                  color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                    Cesium.Color.fromCssColorString(
                      GPSJAM_LEVEL_COLORS[cell.level],
                    ).withAlpha(FILL_ALPHA[cell.level]),
                  ),
                },
              }),
          ),
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
          }),
          classificationType: Cesium.ClassificationType.BOTH,
          allowPicking: false,
          // Retain the compact polygon descriptors for inspection, not Entity visualizers.
          releaseGeometryInstances: false,
        }),
      );
    }
    _viewer?.scene?.requestRender?.();
  }

  const layer = {
    id: 'gpsjam-daily',
    name: 'GPSJam (Daily)',
    icon: '⬡',
    source: 'gpsjam.org',
    updateInterval: 3600000,

    init(viewer) {
      if (_viewer) throw new Error('GPSJam layer is already initialized');
      _viewer = viewer;
      _primitives = new Cesium.PrimitiveCollection();
      _primitives.id = layer.id;
      _primitives.show = false;
      viewer.scene.groundPrimitives.add(_primitives);
      _cells = [];
      _date = null;
      _sourceName = null;
      _suspect = false;
      _stale = false;
      _signature = null;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:GPSJam] Initialized');
    },

    enable() {
      _enabled = true;
      if (_primitives) _primitives.show = true;
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_primitives) _primitives.show = false;
    },

    async update() {
      if (!_enabled || !_primitives) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _cells = Array.isArray(snapshot?.cells) ? snapshot.cells : [];
        _date = typeof snapshot?.date === 'string' ? snapshot.date : null;
        _sourceName =
          typeof snapshot?.source === 'string' ? snapshot.source : null;
        _suspect = snapshot?.suspect === true;
        _stale = snapshot?.stale === true;
        render();
        _lastUpdate = Number.isFinite(snapshot?.fetchedAt)
          ? snapshot.fetchedAt
          : now();
        _lastError = null;
        console.log(
          `[Data:GPSJam] Updated: ${_cells.length} cells for ${_date} (${_cells.filter((cell) => cell.level !== 'low').length} above low)`,
        );
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:GPSJam] Fetch error:', e);
        _lastError = e?.message || msg('GPSJam source unavailable');
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
      _cells = [];
      _date = null;
      _sourceName = null;
      _suspect = false;
      _stale = false;
      _signature = null;
      if (_primitives) {
        viewer.scene.groundPrimitives.remove(_primitives);
        _primitives = null;
      }
      _lastUpdate = null;
      _lastError = null;
    },

    /**
     * Snapshot the layer's cells as plain JSON-safe objects for the
     * analyst query engine. On-demand only — zero per-frame cost, no
     * listeners, no caching. Returns [] while the layer is disabled or
     * empty. One record per H3 cell, positioned at its centroid
     * (see model.js mapAnalystRecord).
     * @param {number} [maxCount=2000] - Maximum records to return.
     * @returns {Array<Object>} See mapAnalystRecord for the record shape.
     */
    getAnalystRecords(maxCount = 2000) {
      if (!_primitives || !_primitives.show) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _cells.slice(0, limit).map((cell, index) =>
        mapAnalystRecord(
          {
            ...cell,
            date: _date,
            source: _sourceName,
            hasPosition: true,
          },
          index,
        ),
      );
    },

    getRowControls() {
      let info = _date
        ? t('Daily aggregate for {date} UTC · not live', { date: _date })
        : t('Daily GPSJam aggregate · not loaded yet');
      if (_suspect)
        info += ` · ${t('gpsjam.org flags this day as incomplete')}`;
      if (_lastError) {
        const translated = translateFeedError(_lastError);
        if (translated) info += ` · ${translated}`;
      }
      return {
        chips: [],
        info,
        infoTitle: t(
          'One hexagon per H3 resolution-4 cell for the published UTC day. Red and yellow hexes show where aircraft reported low navigation accuracy — that is not proof of jamming or spoofing. Green hexes are shown too, so all clear reads apart from no data.',
        ),
        legend: ['high', 'medium', 'low'].map((level, index) => ({
          label: t(LEVEL_LABELS[level]),
          color: GPSJAM_LEVEL_COLORS[level],
          count: _cells.filter((cell) => cell.level === level).length,
          ...(index === 0
            ? {
                blurb: t(
                  'Low-accuracy score = 100 × max(0, bad − 1) / total: one aircraft is discounted, so this is not the raw share. Cells need {aircraft} aircraft in the day. Red and yellow hexes show where aircraft reported low navigation accuracy — that is not proof of jamming.',
                  {
                    aircraft: formatNumber(GPSJAM_MIN_AIRCRAFT),
                  },
                ),
              }
            : {}),
        })),
      };
    },

    getStats() {
      return {
        count: _cells.length,
        levels: Object.fromEntries(
          ['low', 'medium', 'high'].map((level) => [
            level,
            _cells.filter((cell) => cell.level === level).length,
          ]),
        ),
        date: _date,
        source: _sourceName,
        suspect: _suspect,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
        // Load-bearing: without an explicit boolean, layerFeedState reads the
        // gpsjam.org source name as a flights fallback (src/data/feedState.js).
        fallback: false,
      };
    },
  };
  return layer;
}
