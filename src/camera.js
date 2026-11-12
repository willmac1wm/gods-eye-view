import * as Cesium from 'cesium';
import {
  CAPE_MAY_APPROACH_ALT_M,
  CAPE_MAY_STARTUP_VIEW,
} from './share/cameraParams.js';

/**
 * Set camera to Cape May City, NJ on load.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  const { lat, lon, alt, heading, pitch, roll } = CAPE_MAY_STARTUP_VIEW;
  const orientation = {
    heading: Cesium.Math.toRadians(heading),
    pitch: Cesium.Math.toRadians(pitch),
    roll: Cesium.Math.toRadians(roll),
  };
  // Start from high altitude above Cape May City, then settle on the county view.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, CAPE_MAY_APPROACH_ALT_M),
    orientation,
  });

  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation,
      duration: 3.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);

  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}
