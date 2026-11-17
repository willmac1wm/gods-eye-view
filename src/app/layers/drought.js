import { createDroughtLayer } from '../../layers/drought/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire drought to the application overlay host. */
export function createApplicationDrought(options) {
  return createDroughtLayer({ overlayHost, ...options });
}
