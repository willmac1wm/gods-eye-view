import { createInternetOutagesLayer } from '../../layers/internetOutages/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire IODA internet outages to the application overlay host. */
export function createApplicationInternetOutages(options) {
  return createInternetOutagesLayer({ overlayHost, ...options });
}
