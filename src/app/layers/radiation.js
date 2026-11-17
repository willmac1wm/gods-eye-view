import { createRadiationLayer } from '../../layers/radiation/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire radiation to the application overlay host. */
export function createApplicationRadiation(options) {
  return createRadiationLayer({ overlayHost, ...options });
}
