import { catalogControlServices } from './catalog.js';
import { StyleManager } from '../ui/composition.js';
import { applyStartView, flyToCapeMay, START_VIEW } from '../camera.js';
import { startupCameraAfterReturn } from '../share/returnView.js';
import { CAPE_MAY_STARTUP_VIEW } from '../share/cameraParams.js';
import { toRadians } from '../geo/index.js';
import { initCockpitCloudEffects } from '../cockpitCloudEffects.js';
import { createViewSky } from '../viewSky.js';
import { cameraOf, findGlobe } from '../render/rendererOf.js';
import { useDisplayStore } from '../ui/stores/display.js';
import { applicationPinia } from '../ui/vueRuntime.js';
import { t } from '../i18n/index.js';

/** Where the camera starts unless a host gives a `startView`. */
export { START_VIEW };

/**
 * Cape May Dispatch's home, in the start view's shape: the settled startup
 * view over Cape May City. The title's logo goes back here unless a host
 * gives a `startView` or `homeView` (Cape HOME stays on Cape May County).
 */
export const CAPE_MAY_HOME_VIEW = Object.freeze({
  lon: CAPE_MAY_STARTUP_VIEW.lon,
  lat: CAPE_MAY_STARTUP_VIEW.lat,
  height: CAPE_MAY_STARTUP_VIEW.alt,
  heading: CAPE_MAY_STARTUP_VIEW.heading,
  pitch: CAPE_MAY_STARTUP_VIEW.pitch,
});

/** The storage the last valid view lives in, or null where it is blocked. */
function lastViewStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Construct the existing controls and camera presentation. `initialShareCode`
 * opens a share code (the `<code>` of `/share/<code>`) at start-up, for a host
 * whose address does not carry one. `localePicker: false` removes the language
 * picker, for a host that offers its own language choice (`switchLocale` from
 * the `./i18n` entry). `startView` is where the camera starts (the whole
 * planet by default; a host may pass a city); a shared view flies from there.
 * Without a share or a host's own `startView`, the camera then goes to the
 * last valid view or flies to Cape May: never null island. A host's
 * `startView` is kept as given.
 * `homeView` is where the title's logo goes back to (with the clock live):
 * Cape May unless a `startView` is given, then the start view unless given,
 * for a host whose `startView` only carries a view across a rebuild.
 * `services.cockpitSubjects` adds the application's own first-person subjects
 * to the Cockpit (src/cockpitSubjectProviders.js).
 */
export function createApplicationControls({
  scene: { viewer, mapStackController, operations, viewerDrawsEntity },
  loaderStatus,
  Controls = StyleManager,
  services,
  catalog,
  placeSearch,
  defer,
  initialShareCode = null,
  localePicker = true,
  startView = START_VIEW,
  homeView = startView === START_VIEW ? CAPE_MAY_HOME_VIEW : startView,
}) {
  // Every boot starts from the same view, before share restoration flies on.
  applyStartView(viewer, startView);
  // Initialize the style manager (post-processing, HUD, locations, share links)
  const styleManager = new Controls(viewer, {
    services: {
      ...services,
      ...operations.surface.controlServices,
      searchAndFlyTo: operations.searchAndFlyTo,
      pickWorldFromScreen: operations.annotationResolver?.pickWorldFromScreen,
      fetchRegionalBrief: (...args) =>
        operations.requests.regional.getBrief(...args),
      ...catalogControlServices(catalog),
      // Whether an entity is one of the viewer's own; the scene answers it.
      viewerDrawsEntity: viewerDrawsEntity ?? services?.viewerDrawsEntity,
    },
    requestServices: operations.requests,
    mapStackController,
    placeSearch,
    // A share code to open at start-up instead of the page's address.
    initialShareCode,
    localePicker,
    homeView,
  });
  defer(() => styleManager.orbitController.stop());
  defer(() => styleManager.hud.destroy());
  defer(() => styleManager.dispose());
  // The previous multi-canvas weather compositor remains disabled. Cockpit
  // clouds use a separate, capped low-resolution GPU pass that never attaches
  // Cesium fog or post-process stages and is fully stopped in map mode.
  const weatherEffects = null;
  // Where the renderer draws weather, it draws the cockpit's clouds too.
  const cockpitCloudEffects = findGlobe(viewer)?.weather
    ? null
    : initCockpitCloudEffects(viewer, {
        weatherService: operations.requests.weather,
      });
  defer(() => cockpitCloudEffects?.destroy());
  // The atmosphere, sun lighting, sun, moon, stars and Milky Way the user
  // chooses in the Display panel.
  const viewSky = createViewSky(viewer, {
    store: useDisplayStore(applicationPinia()),
  });
  defer(() => viewSky.destroy());

  // No usable share: the last valid view, or Cape May. Never null island.
  // A host that gave its own start view (a city, or the view it carries
  // across a rebuild) stays there.
  if (styleManager.hasShareState) {
    loaderStatus.textContent = t('Restoring shared view...');
  } else if (startView !== START_VIEW) {
    loaderStatus.textContent = t('Loading');
  } else {
    loaderStatus.textContent = t('Flying to Cape May...');
    const saved = startupCameraAfterReturn({
      hash: globalThis.location?.hash,
      storage: lastViewStorage(),
    });
    if (
      saved &&
      (saved.lat !== CAPE_MAY_STARTUP_VIEW.lat ||
        saved.lon !== CAPE_MAY_STARTUP_VIEW.lon ||
        saved.alt !== CAPE_MAY_STARTUP_VIEW.alt)
    ) {
      cameraOf(viewer).setView({
        destination: { lon: saved.lon, lat: saved.lat, height: saved.alt },
        orientation: {
          heading: toRadians(saved.heading),
          pitch: toRadians(saved.pitch),
          roll: toRadians(saved.roll),
        },
      });
    } else {
      defer(flyToCapeMay(viewer));
    }
  }

  return { styleManager, weatherEffects, cockpitCloudEffects };
}
