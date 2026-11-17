import { createHifldInstallationsLayer } from '../../layers/hifldInstallations/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the HIFLD installations snapshot to the application overlay host. */
export function createApplicationHifld(options) {
  return createHifldInstallationsLayer({ overlayHost, ...options });
}
