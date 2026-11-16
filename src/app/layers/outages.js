import { createOutagesLayer } from '../../layers/outages/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire county outage observations to the application overlay host. */
export function createApplicationOutages(options) {
  return createOutagesLayer({ overlayHost, ...options });
}
