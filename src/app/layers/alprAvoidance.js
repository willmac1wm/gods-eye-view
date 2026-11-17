import { createAlprAvoidanceLayer } from '../../layers/alprAvoidance/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire ALPR-avoidance routing to the application overlay host. The
 * rendering defaults to the real Cesium-backed one (injectable for tests). */
export function createApplicationAlprAvoidance(options) {
  return createAlprAvoidanceLayer({ overlayHost, ...options });
}
