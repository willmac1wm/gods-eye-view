import { createFalloutPlumeLayer } from '../../layers/plume/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the NWS wind plume to the application overlay host. */
export function createApplicationPlume(options) {
  return createFalloutPlumeLayer({ overlayHost, ...options });
}
