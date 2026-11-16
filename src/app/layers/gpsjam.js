import { createGpsjamLayer } from '../../layers/gpsjam/index.js';

/** Wire the GPSJam daily GNSS-interference layer into the application catalog. */
export function createApplicationGpsjam(options) {
  return createGpsjamLayer(options);
}
