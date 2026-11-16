import { createSatnogsLayer } from '../../layers/satnogs/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire SatNOGS satellite observations to the application overlay host. */
export function createApplicationSatnogs(options) {
  return createSatnogsLayer({ overlayHost, ...options });
}
