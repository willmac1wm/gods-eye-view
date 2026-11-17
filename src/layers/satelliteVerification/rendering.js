import * as Cesium from 'cesium';
import { NO_IMAGERY_HOST, resolveImageryHost } from '../../maps/imageryHost.js';
import { SATELLITE_COUNTY_BBOX } from './policy.js';

/**
 * One GIBS true-color drape for the satellite-verification layer: a
 * single UrlTemplateImageryProvider over the county rectangle, on
 * whichever host the map stack offers (globe imageryLayers, or the
 * 3D-tiles stack's own imageryLayers). At most one drape per slot; the
 * layer owns two slots (A = active date, B = compare date) and shows
 * one or both. Every layer is removed from the collection that owns it,
 * so a host switch or a replaced date never strands one. Cesium is
 * injectable so tests run without WebGL.
 */
export function createSatelliteDrape({
  host = resolveImageryHost,
  cesium = Cesium,
  createProvider = (template, rectangle, credit) =>
    new cesium.UrlTemplateImageryProvider({
      url: template,
      subdomains: ['a', 'b', 'c'],
      minimumLevel: 0,
      maximumLevel: 9,
      tilingScheme: new cesium.WebMercatorTilingScheme(),
      rectangle,
      credit,
      hasAlphaChannel: false,
    }),
  createImageryLayer = (provider) => new cesium.ImageryLayer(provider),
} = {}) {
  let _viewer = null;
  let _tileset = null;
  let _hostInfo = { collection: null, kind: 'none' };
  /** slotId -> { collection, layer, template, alpha } */
  const _owned = new Map();

  function rectangle() {
    const { latMin, latMax, lonMin, lonMax } = SATELLITE_COUNTY_BBOX;
    return cesium.Rectangle.fromDegrees(lonMin, latMin, lonMax, latMax);
  }

  function detach(slotId, destroy) {
    const record = _owned.get(slotId);
    if (!record) return;
    _owned.delete(slotId);
    const { collection, layer } = record;
    try {
      if (collection?.contains?.(layer)) collection.remove(layer, destroy);
      else if (destroy) layer.destroy?.();
    } catch {
      /* the collection is already gone */
    }
  }

  function syncHost() {
    const next = host({ viewer: _viewer, tileset: _tileset }) || {
      collection: null,
      kind: 'none',
    };
    const changed =
      next.collection !== _hostInfo.collection || next.kind !== _hostInfo.kind;
    _hostInfo = next;
    if (changed) {
      // Re-home every visible drape on the new collection.
      for (const [slotId, record] of [..._owned.entries()]) {
        const { template, credit, alpha } = record;
        detach(slotId, false);
        show(slotId, { template, credit, alpha });
      }
    }
    return changed;
  }

  function show(slotId, { template, credit, alpha = 1 } = {}) {
    if (!template) throw new TypeError('Satellite drape needs a tile template');
    detach(slotId, true);
    if (!_hostInfo.collection) return { shown: false, reason: NO_IMAGERY_HOST };
    const provider = createProvider(template, rectangle(), credit);
    const layer = createImageryLayer(provider);
    layer.alpha = alpha;
    _hostInfo.collection.add(layer);
    _owned.set(slotId, {
      collection: _hostInfo.collection,
      layer,
      template,
      credit,
      alpha,
    });
    return { shown: true, kind: _hostInfo.kind };
  }

  return {
    /** Bind the scene the drape lives on (from the layer's init/enable). */
    setScene({ viewer, tileset } = {}) {
      _viewer = viewer ?? null;
      _tileset = tileset ?? null;
      syncHost();
    },

    show,
    hide(slotId) {
      detach(slotId, true);
    },

    setAlpha(slotId, alpha) {
      const record = _owned.get(slotId);
      if (!record) return false;
      const value = Number(alpha);
      record.alpha = Number.isFinite(value)
        ? Math.max(0, Math.min(1, value))
        : 1;
      record.layer.alpha = record.alpha;
      return true;
    },

    getState() {
      return {
        kind: _hostInfo.kind,
        slots: [..._owned.entries()].map(([slotId, record]) => ({
          slotId,
          template: record.template,
          alpha: record.alpha,
        })),
      };
    },

    destroy() {
      for (const slotId of [..._owned.keys()]) detach(slotId, true);
      _viewer = null;
      _tileset = null;
      _hostInfo = { collection: null, kind: 'none' };
    },
  };
}
