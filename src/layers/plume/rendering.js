// src/layers/plume/rendering.js
// Plume geometry renderer (cyclones pattern, simplified): builds a fresh
// Cesium CustomDataSource per snapshot and swaps it in, so a stale plume
// never lingers beside a fresh one. Draws the centroid path polyline,
// the 15° cone polygon (+ outline), the 10-mile EPZ reference circle
// (+ outline), and the release-point marker. No picking, no selection —
// the anchor label (title + disclaimers) goes through the overlay host.
// Colors: plume orange, EPZ gray. All geometry clamps to ground.
import * as Cesium from 'cesium';

const PLUME_COLOR = Cesium.Color.fromCssColorString('#ff8c42');
const EPZ_COLOR = Cesium.Color.fromCssColorString('#9aa5ad');

/** Convert a [lon, lat] ring to Cesium Cartesian3 positions. */
function toPositions(ring) {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0));
}

/**
 * Own the plume's Cesium data source. Double-buffered: setSnapshot
 * builds the next source, swaps it in, and removes the old one.
 */
export function createPlumeRendering({ viewer, cesium = Cesium } = {}) {
  if (!viewer) throw new TypeError('Plume rendering requires a viewer');
  let current = null;
  let destroyed = false;

  function build(snapshot) {
    const next = new cesium.CustomDataSource('fallout-plume');
    const pathPositions = (snapshot.path ?? []).map((node) =>
      cesium.Cartesian3.fromDegrees(node.lon, node.lat, 0),
    );
    const conePositions = toPositions(snapshot.cone ?? []);
    const epzPositions = toPositions(snapshot.epz ?? []);
    const release = snapshot.release ?? {};
    next.entities.add({
      id: 'plume:release',
      name: release.name ?? 'Salem/Hope Creek',
      position: cesium.Cartesian3.fromDegrees(release.lon, release.lat, 0),
      point: {
        heightReference: cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelSize: 10,
        color: PLUME_COLOR,
        outlineColor: cesium.Color.BLACK,
        outlineWidth: 2,
      },
    });
    if (pathPositions.length >= 2) {
      next.entities.add({
        id: 'plume:path',
        polyline: {
          clampToGround: true,
          classificationType: cesium.ClassificationType.BOTH,
          positions: pathPositions,
          width: 2.5,
          material: PLUME_COLOR,
          arcType: cesium.ArcType.GEODESIC,
        },
      });
    }
    if (conePositions.length >= 3) {
      next.entities.add({
        id: 'plume:cone',
        polygon: {
          hierarchy: new cesium.PolygonHierarchy(conePositions),
          classificationType: cesium.ClassificationType.BOTH,
          material: PLUME_COLOR.withAlpha(0.16),
          arcType: cesium.ArcType.GEODESIC,
        },
      });
      next.entities.add({
        id: 'plume:cone:outline',
        polyline: {
          positions: [...conePositions, conePositions[0]],
          width: 1,
          material: PLUME_COLOR.withAlpha(0.55),
          arcType: cesium.ArcType.GEODESIC,
          clampToGround: true,
        },
      });
    }
    if (epzPositions.length >= 3) {
      next.entities.add({
        id: 'plume:epz',
        polygon: {
          hierarchy: new cesium.PolygonHierarchy(epzPositions),
          classificationType: cesium.ClassificationType.BOTH,
          material: EPZ_COLOR.withAlpha(0.05),
          arcType: cesium.ArcType.GEODESIC,
        },
      });
      next.entities.add({
        id: 'plume:epz:outline',
        polyline: {
          positions: epzPositions,
          width: 1,
          material: EPZ_COLOR.withAlpha(0.4),
          arcType: cesium.ArcType.GEODESIC,
          clampToGround: true,
        },
      });
    }
    return next;
  }

  return {
    /** Swap in the geometry for a snapshot; false when destroyed. */
    setSnapshot(snapshot, { signal } = {}) {
      signal?.throwIfAborted();
      if (destroyed) return false;
      const next = build(snapshot);
      const previous = current;
      current = next;
      viewer.dataSources.add(next);
      if (previous) viewer.dataSources.remove(previous, true);
      return true;
    },

    /** Hide or show the current geometry without dropping it. */
    setVisible(visible) {
      if (current) current.show = visible;
    },

    /** Drop the current geometry (kept for disable/destroy). */
    clear() {
      if (current) {
        viewer.dataSources.remove(current, true);
        current = null;
      }
    },

    destroy() {
      destroyed = true;
      this.clear();
    },
  };
}
