import * as Cesium from 'cesium';
import { NO_IMAGERY_HOST, resolveImageryHost } from '../../maps/imageryHost.js';

// Portable package (no i18n): messages stay English data.
const msg = (text) => text;

/** Status + image through this server's /api/sar-flood proxy. */
export function createSarFloodSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  base = '/api/sar-flood',
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const response = await fetchImpl(`${base}/status`, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Radar flood HTTP ${response.status}`);
      const status = await response.json();
      return {
        ...status,
        imageUrl: status?.available
          ? `${base}/new-water.png?pass=${encodeURIComponent(status.latestPass || '')}`
          : null,
      };
    },
  };
}

/**
 * Sentinel-1 radar "new water" over Cape May County, draped on the globe or
 * the photoreal tileset (whichever the map stack shows).
 */
export function createSarFloodLayer({ source, host = resolveImageryHost } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Radar flood requires a snapshot source');
  let _viewer = null;
  let _tileset = null;
  let _enabled = false;
  let _status = null;
  let _imagery = null;
  let _collection = null;
  let _hostKind = 'none';
  let _lastUpdate = null;
  let _lastError = null;
  let _request = null;

  function detach() {
    if (_imagery && _collection && !_collection.isDestroyed?.())
      _collection.remove(_imagery, true);
    _imagery = null;
    _collection = null;
  }

  function attach() {
    detach();
    if (!_enabled || !_viewer || !_status?.imageUrl) return;
    const target = host({ viewer: _viewer, tileset: _tileset }) || {};
    _hostKind = target.kind || 'none';
    if (!target.collection) return;
    const [w, s, e, n] = _status.bbox;
    const provider = new Cesium.SingleTileImageryProvider({
      url: _status.imageUrl,
      rectangle: Cesium.Rectangle.fromDegrees(w, s, e, n),
      tileWidth: 1400,
      tileHeight: 1500,
      credit: _status.attribution || 'Copernicus Sentinel-1',
    });
    _collection = target.collection;
    _imagery = _collection.addImageryProvider(provider);
    _imagery.alpha = 0.85;
    _collection.raiseToTop?.(_imagery);
    _viewer.scene?.requestRender?.();
  }

  return {
    id: 'sar-flood',
    name: 'Radar Flood (Sentinel-1)',
    icon: '🌊',
    source: 'Copernicus Sentinel-1',
    updateInterval: 30 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
    },

    /** The photoreal tileset, for draping while the globe is hidden. */
    attachTileset(tileset) {
      _tileset = tileset || null;
      if (_enabled) attach();
    },

    enable() {
      _enabled = true;
      attach();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      detach();
    },

    async update() {
      if (!_enabled) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const status = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || !_enabled) return false;
        const changed = status?.imageUrl !== _status?.imageUrl;
        _status = status;
        _lastUpdate = Date.now();
        if (!status?.configured) {
          _lastError = msg('Radar flood is not configured (Copernicus key)');
        } else if (!status?.available) {
          _lastError = status?.error || msg('No radar pass rendered yet');
        } else {
          _lastError = null;
        }
        const target = host({ viewer: _viewer, tileset: _tileset }) || {};
        if (changed || (target.collection ?? null) !== _collection) attach();
        if (_status?.imageUrl && !_collection) _lastError = NO_IMAGERY_HOST;
        return true;
      } catch (error) {
        if (request.signal.aborted) return false;
        _lastError = error?.message || msg('Radar flood unavailable');
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy() {
      _request?.abort();
      _enabled = false;
      detach();
      _viewer = null;
      _tileset = null;
      _status = null;
    },

    getAnalystRecords() {
      if (!_enabled || !_status?.available) return [];
      return [
        {
          id: `sar-flood:${_status.latestPass}`,
          latestPass: _status.latestPass,
          baselinePasses: (_status.baselinePasses || []).join(', '),
          renderedMs: _status.renderedAt ?? null,
        },
      ];
    },

    getStats() {
      return {
        count: _status?.available ? 1 : 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
        detail: _status?.latestPass
          ? `Pass ${_status.latestPass} vs ${(_status.baselinePasses || []).length} earlier`
          : undefined,
      };
    },
  };
}
