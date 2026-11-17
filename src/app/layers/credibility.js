import { createCredibilityLayer } from '../../layers/credibility/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the credibility scores to the application overlay host. */
export function createApplicationCredibility(options) {
  return createCredibilityLayer({ overlayHost, ...options });
}
