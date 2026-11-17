import { createTrafficCamerasSource } from '../layers/trafficCameras/index.js';
import { createApplicationTrafficCameras } from '../app/layers/trafficCameras.js';
export * from '../layers/trafficCameras/index.js';
/** Wire the standalone source and application overlay owner. */
export function createTrafficCamerasLayer({
  source = createTrafficCamerasSource(),
  ...options
} = {}) {
  return createApplicationTrafficCameras({ source, ...options });
}
