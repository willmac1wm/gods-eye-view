import { createEmergencyCompositeLayer } from '../../layers/emergencyComposite/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the emergency composite to the application overlay host. */
export function createApplicationEmergencyComposite(options) {
  return createEmergencyCompositeLayer({ overlayHost, ...options });
}
