import { createMarineWarningsLayer } from '../../layers/marineWarnings/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire USCG Broadcast Notices to Mariners to the application overlay host. */
export function createApplicationMarineWarnings(options) {
  return createMarineWarningsLayer({ overlayHost, ...options });
}
