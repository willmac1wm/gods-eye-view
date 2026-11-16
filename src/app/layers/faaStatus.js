import { createFaaStatusLayer } from '../../layers/faaStatus/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire FAA airport status to the application overlay host. */
export function createApplicationFaaStatus(options) {
  return createFaaStatusLayer({ overlayHost, ...options });
}
