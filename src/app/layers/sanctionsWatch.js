import { createSanctionsWatchLayer } from '../../layers/sanctionsWatch/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire sanctions watch to the application overlay host. */
export function createApplicationSanctionsWatch(options) {
  return createSanctionsWatchLayer({ overlayHost, ...options });
}
