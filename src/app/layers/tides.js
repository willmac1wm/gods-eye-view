import { createTidesLayer } from '../../layers/tides/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire tide-gauge observations to the application overlay host. */
export function createApplicationTides(options) {
  return createTidesLayer({ overlayHost, ...options });
}
