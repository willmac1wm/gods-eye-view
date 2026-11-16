import { createDisasterLayer } from '../../layers/disasterHistory/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire federal disaster history to the application overlay host. */
export function createApplicationDisasterHistory(options) {
  return createDisasterLayer({ overlayHost, ...options });
}
