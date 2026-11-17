import { createGaugesLayer } from '../../layers/gauges/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire live USGS water gauges to the application overlay host. */
export function createApplicationGauges(options) {
  return createGaugesLayer({ overlayHost, ...options });
}
