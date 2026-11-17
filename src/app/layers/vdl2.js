import { createVdl2Layer } from '../../layers/vdl2/index.js';
import { overlayHost } from './overlayHost.js';

/** Wire VDL2 datalink messages to the application overlay host. */
export function createApplicationVdl2(options) {
  return createVdl2Layer({ overlayHost, ...options });
}
