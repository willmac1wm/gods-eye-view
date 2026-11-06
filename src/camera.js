import * as Cesium from 'cesium';

/**
 * Set camera to Cape May County, NJ on load with a cinematic fly-in.
 * The export name stays `flyToAustin` so existing startup imports keep working.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  // County overview, then settle over the peninsula.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-74.91, 38.935, 45000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-74.91, 38.935, 12000),
      orientation: {
        heading: Cesium.Math.toRadians(20),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}

/** Region home: Cape May County. */
export const flyToCapeMay = flyToAustin;
