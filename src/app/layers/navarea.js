import { createNavareaLayer } from '../../layers/navarea/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire NAVAREA warnings to the application overlay host. */
export function createApplicationNavarea(options) {
  return createNavareaLayer({ overlayHost, ...options });
}
