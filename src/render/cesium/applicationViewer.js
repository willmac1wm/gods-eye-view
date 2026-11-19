import * as Cesium from 'cesium';
import { applyModelAtmosphereWorkaround } from '../../app/atmosphereCompat.js';
import { IDLE_FRAME_RATE } from '../../renderGovernor.js';
import { preloadImageryAhead } from './imageryLookAhead.js';
import { StarrySky } from './starrySky.js';
import {
  bindGraphicsLifecycle,
  clearCesiumErrorPanel,
  constructViewerWithRetry,
  releaseViewer,
  showGraphicsReset,
} from '../../app/graphicsReset.js';

/**
 * At the farthest a hand can zoom out, the globe is this share of the
 * screen's height across. Cesium sets no limit, so zooming on left the globe
 * a speck among the stars.
 */
const MIN_GLOBE_SHARE = 0.3;

/**
 * The farthest a hand can zoom out, in metres above the ellipsoid, for a
 * vertical field of view. It follows the screen's shape, as the app's own
 * whole-globe view does, so that view always lies within it.
 * @param {number} fovy Vertical field of view, radians.
 */
export function zoomOutLimit(fovy) {
  const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
  const angular = Math.atan(MIN_GLOBE_SHARE * Math.tan(fovy / 2));
  return radius / Math.sin(angular) - radius;
}

/**
 * Hold a hand's zoom out to `zoomOutLimit` on the globe, each frame, since the
 * field of view follows the screen's shape. The limit never sits below the
 * camera: one already past it (a flight, a screen turned) stops there rather
 * than jumping in at the next zoom. Flat maps keep Cesium's own, unlimited.
 * @returns {() => void} Stop limiting.
 */
export function limitZoomOut(viewer) {
  const { scene, camera } = viewer;
  return scene.preRender.addEventListener(() => {
    const controller = scene.screenSpaceCameraController;
    const fovy = camera.frustum.fovy;
    if (scene.mode !== Cesium.SceneMode.SCENE3D || !Number.isFinite(fovy)) {
      controller.maximumZoomDistance = Number.POSITIVE_INFINITY;
      return;
    }
    controller.maximumZoomDistance = Math.max(
      zoomOutLimit(fovy),
      camera.positionCartographic?.height ?? 0,
    );
  });
}

// Dev convenience: expose the app's Cesium instance for console/preview probing
// (single shared module instance — avoids dual-Cesium state bugs when testing).
if (typeof window !== 'undefined' && !window.__CESIUM__)
  window.__CESIUM__ = Cesium;

/**
 * Cesium.Viewer options of the standard globe viewer. `showRenderLoopErrors`
 * false leaves render errors to the caller's own notice instead of Cesium's
 * panel; `msaa` is the multisampling to start with (0 off, 4 by default).
 * The drawing buffer is kept after presenting, for `capture` and
 * `readPixels` to read the frame drawn.
 */
export function applicationViewerOptions(
  creditContainer,
  { showRenderLoopErrors = true, msaa = 4 } = {},
) {
  return {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    // Replaces the blocky Tycho-2 default. An option, not `skyBox: false`,
    // which would also stop CesiumWidget from creating the Sun and Moon.
    skyBox: new StarrySky(),
    creditContainer,
    // Cesium's 1 is no multisampling.
    msaaSamples: msaa || 1,
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
    showRenderLoopErrors,
  };
}

/**
 * Release the viewer when the page goes away, so a crashed tab does not hold
 * the WebGL context the next one needs. Returns a function that stops.
 */
function releaseOnPageExit(viewer, windowRef) {
  const release = () => releaseViewer(viewer);
  windowRef?.addEventListener?.('pagehide', release);
  windowRef?.addEventListener?.('unload', release);
  return () => {
    windowRef?.removeEventListener?.('pagehide', release);
    windowRef?.removeEventListener?.('unload', release);
  };
}

/**
 * Create the standard globe viewer in caller-owned, visible containers;
 * `msaa` as `applicationViewerOptions` takes it.
 *
 * A lost or failed WebGL context used to leave Cesium's raw dialog up and the
 * crashed tab holding the context, so the next tab could not start
 * (../../app/graphicsReset.js). Construction is tried twice; when both fail,
 * Cesium's error panel gives way to the branded "Graphics reset needed"
 * screen. Leaving the page releases the viewer. After construction, render
 * errors and a lost context go to the caller's own notice with
 * `showRenderLoopErrors: false` (the application's `renderFailureNotice`),
 * to Cesium's panel with `true`, and, given neither, to the branded screen
 * in place of Cesium's panel. `documentRef`, `windowRef` and `Viewer` can be
 * injected for tests.
 */
export function createApplicationViewer({
  container,
  creditContainer,
  showRenderLoopErrors,
  msaa,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  Viewer = Cesium.Viewer,
}) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  // No notice of the caller's and no Cesium panel asked for: the branded
  // screen stands in for Cesium's panel.
  const brandedReset = showRenderLoopErrors === undefined;
  const constructed = constructViewerWithRetry(
    () =>
      new Viewer(
        container,
        applicationViewerOptions(creditContainer, {
          showRenderLoopErrors: brandedReset ? false : showRenderLoopErrors,
          msaa,
        }),
      ),
    {
      beforeRetry() {
        clearCesiumErrorPanel(container, documentRef);
      },
    },
  );
  if (!constructed.viewer) {
    clearCesiumErrorPanel(container, documentRef);
    showGraphicsReset(documentRef, windowRef);
    throw constructed.error;
  }
  const viewer = constructed.viewer;
  try {
    // Until the render governor takes over (src/renderGovernor.js, installed
    // by src/app/scene.js), tick at the idle rate so the startup load does
    // not compete with drawing at 240 fps.
    viewer.targetFrameRate = IDLE_FRAME_RATE;
    // No double-click follow or zoom: the Viewer's own (it tracked or
    // zoomed to the entity picked) is off. Following is a layer's click.
    viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );
    // A phone pinch spans fewer screen pixels than desktop zoom gestures.
    // Keep Cesium's distance-aware zoom and collision limits, with less travel
    // required on touch-first screens. Mouse/trackpad sensitivity stays native.
    if (globalThis.matchMedia?.('(pointer: coarse)').matches)
      viewer.scene.screenSpaceCameraController.zoomFactor *= 3;
    limitZoomOut(viewer);
    // A narrow view carried along an orbit outruns the imagery under it.
    preloadImageryAhead(viewer);
    // Before any tile builds a draw command: Cesium's per-vertex model
    // atmosphere fails to LINK on Apple's Metal backend and kills the
    // render loop. See app/atmosphereCompat.js.
    applyModelAtmosphereWorkaround(viewer.scene);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    if (brandedReset)
      bindGraphicsLifecycle(viewer, {
        documentRef,
        windowRef,
        onReset(reason) {
          if (reason === 'render-error') releaseViewer(viewer);
          showGraphicsReset(documentRef, windowRef);
        },
      });
    else releaseOnPageExit(viewer, windowRef);
    return viewer;
  } catch (error) {
    releaseViewer(viewer);
    throw error;
  }
}
