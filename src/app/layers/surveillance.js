import { createSurveillanceLayer } from '../../layers/surveillance/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire OSM surveillance-camera locations to the application overlay host. */
export function createApplicationSurveillance(options) {
  return createSurveillanceLayer({ overlayHost, ...options });
}
