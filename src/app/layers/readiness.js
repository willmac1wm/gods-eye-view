import { createReadinessLayer } from '../../layers/readiness/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire readiness to the application overlay host. */
export function createApplicationReadiness(options) {
  return createReadinessLayer({ overlayHost, ...options });
}
