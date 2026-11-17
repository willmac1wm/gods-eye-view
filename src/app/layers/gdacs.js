import { createGdacsLayer } from '../../layers/gdacs/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire GDACS multi-hazard events to the application overlay host. */
export function createApplicationGdacs(options) {
  return createGdacsLayer({ overlayHost, ...options });
}
