import { createPortsLayer } from '../../layers/ports/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire ports + chokepoints to the application overlay host. */
export function createApplicationPorts(options) {
  return createPortsLayer({ overlayHost, ...options });
}
