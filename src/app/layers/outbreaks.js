import { createOutbreaksLayer } from '../../layers/outbreaks/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire CDC ArboNET + WHO Disease Outbreak News to the application overlay host. */
export function createApplicationOutbreaks(options) {
  return createOutbreaksLayer({ overlayHost, ...options });
}
