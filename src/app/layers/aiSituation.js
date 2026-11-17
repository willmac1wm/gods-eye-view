import { createAiSituationLayer } from '../../layers/aiSituation/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire the AI situation layer to the application overlay host. */
export function createApplicationAiSituation(options) {
  return createAiSituationLayer({ overlayHost, ...options });
}
