import { createFuelLayer } from '../../layers/fuel/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire weekly fuel prices to the application overlay host. */
export function createApplicationFuel(options) {
  return createFuelLayer({ overlayHost, ...options });
}
