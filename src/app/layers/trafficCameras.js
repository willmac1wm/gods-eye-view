import { createTrafficCamerasLayer } from '../../layers/trafficCameras/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire live traffic cameras to the application overlay host. */
export function createApplicationTrafficCameras(options) {
  return createTrafficCamerasLayer({ overlayHost, ...options });
}
