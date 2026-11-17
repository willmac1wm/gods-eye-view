import { createSatelliteVerificationLayer } from '../../layers/satelliteVerification/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire satellite verification to the application overlay host. The
 * drape defaults to the real Cesium-backed one (injectable for tests). */
export function createApplicationSatelliteVerification(options) {
  return createSatelliteVerificationLayer({ overlayHost, ...options });
}
