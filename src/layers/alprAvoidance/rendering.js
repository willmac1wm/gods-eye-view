import * as Cesium from 'cesium';
import {
  ALPR_AVOIDANCE_FASTEST_COLOR,
  ALPR_AVOIDANCE_LOWEST_COLOR,
} from './policy.js';

/**
 * The two scored routes on the globe: the fastest as a solid line, the
 * lowest-exposure as a dashed line, with a dot at each known camera that
 * lies on the route it belongs to. The cameras themselves are drawn by the
 * ALPR layer; these dots only mark which ones each route passes. Cesium is
 * injectable so tests run without WebGL. Every entity is removed from the
 * collection that owns it, so a replaced route never strands one.
 * @param {object} options
 * @param {object} options.cesium Cesium namespace (injectable for tests).
 * @returns {{setScene: Function, show: Function, hide: Function, getState: Function, destroy: Function}}
 */
export function createAlprAvoidanceRendering({ cesium = Cesium } = {}) {
  let _viewer = null;
  /** entityId -> entity */
  const _owned = new Map();

  function detach(id) {
    const entity = _owned.get(id);
    if (!entity) return;
    _owned.delete(id);
    try {
      _viewer?.entities.remove(entity);
    } catch {
      /* the collection is already gone */
    }
  }

  function addRoute(id, route, color, dashed) {
    if (!route?.geometry?.length) return;
    const positions = cesium.Cartesian3.fromDegreesArray(route.geometry.flat());
    const material = dashed
      ? new cesium.PolylineDashMaterialProperty({
          color: cesium.Color.fromCssColorString(color),
        })
      : cesium.Color.fromCssColorString(color);
    const entity = _viewer.entities.add({
      id,
      polyline: {
        positions,
        width: 6,
        material,
        clampToGround: true,
        classificationType: cesium.ClassificationType.BOTH,
      },
    });
    _owned.set(id, entity);
  }

  function addCameraDots(prefix, route, color) {
    for (const camera of route?.onRoute || []) {
      const id = `${prefix}:${camera.id}`;
      const entity = _viewer.entities.add({
        id,
        position: cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, 0),
        point: {
          pixelSize: 8,
          color: cesium.Color.fromCssColorString(color),
          outlineColor: cesium.Color.BLACK,
          outlineWidth: 1,
          heightReference: cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      _owned.set(id, entity);
    }
  }

  return {
    setScene({ viewer } = {}) {
      _viewer = viewer || null;
    },

    show({ fastest, lowest, sameRoute } = {}) {
      this.hide();
      if (!_viewer) return { shown: false, reason: 'no-viewer' };
      addRoute(
        'alpr-avoidance:route:fastest',
        fastest,
        ALPR_AVOIDANCE_FASTEST_COLOR,
        false,
      );
      addCameraDots(
        'alpr-avoidance:camera:fastest',
        fastest,
        ALPR_AVOIDANCE_FASTEST_COLOR,
      );
      if (!sameRoute && lowest) {
        addRoute(
          'alpr-avoidance:route:lowest',
          lowest,
          ALPR_AVOIDANCE_LOWEST_COLOR,
          true,
        );
        addCameraDots(
          'alpr-avoidance:camera:lowest',
          lowest,
          ALPR_AVOIDANCE_LOWEST_COLOR,
        );
      }
      return { shown: true, entities: _owned.size };
    },

    hide() {
      for (const id of [..._owned.keys()]) detach(id);
    },

    getState() {
      return { entities: _owned.size, hasViewer: Boolean(_viewer) };
    },

    destroy() {
      this.hide();
      _viewer = null;
    },
  };
}
