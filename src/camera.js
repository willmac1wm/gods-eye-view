import { toRadians } from './geo/index.js';
import { cameraOf } from './render/rendererOf.js';
import {
  CAPE_MAY_APPROACH_ALT_M,
  CAPE_MAY_STARTUP_VIEW,
} from './share/cameraParams.js';

/**
 * The view the renderer starts from: the whole planet, looking straight
 * down, centred where Cesium's default view rectangle is.
 */
export const START_VIEW = Object.freeze({
  lon: -82.5,
  lat: 35,
  height: 23000000,
});

/**
 * Put the camera at a start view without a flight. A host may pass a city
 * (`{ lon, lat, height, heading?, pitch? }`, angles in degrees) instead of
 * the planet.
 */
export function applyStartView(viewer, view = START_VIEW) {
  const { lon, lat, height, heading = 0, pitch = -90 } = view;
  cameraOf(viewer).setView({
    destination: { lon, lat, height },
    orientation: {
      heading: toRadians(heading),
      pitch: toRadians(pitch),
      roll: 0,
    },
  });
}

/**
 * Set camera to Cape May City, NJ on load.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  const camera = cameraOf(viewer);
  const { lat, lon, alt, heading, pitch, roll } = CAPE_MAY_STARTUP_VIEW;
  const orientation = {
    heading: toRadians(heading),
    pitch: toRadians(pitch),
    roll: toRadians(roll),
  };
  // Start from high altitude above Cape May City, then settle on the county view.
  camera.setView({
    destination: { lon, lat, height: CAPE_MAY_APPROACH_ALT_M },
    orientation,
  });

  let flight = null;
  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    flight = camera.flyTo(
      { lon, lat, height: alt },
      {
        orientation,
        durationS: 3.0,
        easing: 'cubicInOut',
      },
    );
  }, 500);

  return () => {
    clearTimeout(timer);
    // Only the fly-in: a flight the user started since is theirs.
    if (!viewer.isDestroyed()) flight?.cancel();
  };
}

/** Region home: Cape May County. */
export const flyToCapeMay = flyToAustin;
