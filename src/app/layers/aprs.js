import { createAprsLayer } from '../../layers/aprs/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire APRS / CWOP station observations to the application overlay host. */
export function createApplicationAprs(options) {
  return createAprsLayer({ overlayHost, ...options });
}
